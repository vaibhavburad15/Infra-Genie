"""Server (EC2) configuration with Ansible.

Workspace layout (``<deployment workspace>/ansible``)::

    ansible.cfg
    inventory.ini                 # written after Terraform creates the server
    group_vars/all/main.yml       # app settings (shown in the UI)
    group_vars/all/secrets.yml    # app environment, e.g. DATABASE_URL (redacted in the UI)
    playbooks/<id>.yml            # built-in playbooks (BUILTIN_PLAYBOOKS)
    roles/{common,python,node,app,nginx}/...
    files/source.zip              # only for uploaded-zip projects
    .ssh/id_ed25519               # per-deployment key (never served)

Playbooks run inside the ``infragenie-ansible`` container (ansible/Dockerfile)
because Ansible has no native Windows control node. Servers are reached over
SSH with the per-deployment key; Terraform opens port 22 only to the worker's
public IP.
"""
from __future__ import annotations

import hashlib
import json
import logging
import re
import shutil
import subprocess
import urllib.request
from pathlib import Path
from typing import Any, Callable, Optional

logger = logging.getLogger(__name__)

_DOCKERFILE_DIR = Path(__file__).resolve().parent / "ansible"
# The tag is derived from the Dockerfile, so changing it builds a new image
# instead of silently reusing an outdated one.
IMAGE = "infragenie-ansible:" + hashlib.sha256(
    (_DOCKERFILE_DIR / "Dockerfile").read_bytes().replace(b"\r\n", b"\n")
).hexdigest()[:12]
SSH_USER = "ubuntu"
_RUN_TIMEOUT = 3600

BUILTIN_PLAYBOOKS: dict[str, dict[str, str]] = {
    "deploy": {"label": "Deploy application",
               "description": "Install the runtime, fetch the code, configure the service and nginx, then health-check."},
    "restart": {"label": "Restart application",
                "description": "Restart the application service."},
    "health_check": {"label": "Health check",
                     "description": "Check the service, the app port and nginx."},
    "logs": {"label": "Show logs",
             "description": "Print the last 200 lines of the application log."},
    "update_os": {"label": "Update OS packages",
                  "description": "Apply Ubuntu package updates and report whether a reboot is needed."},
}

_SKIP_DIRS = {"node_modules", ".git", "venv", ".venv", "__pycache__", "dist", "build"}
_SECRET_FILES = {"group_vars/all/secrets.yml"}


class AnsibleError(RuntimeError):
    """User-facing Ansible / server-configuration error."""


def ansible_dir(workspace: Path) -> Path:
    return workspace / "ansible"


def has_ansible(workspace: Path) -> bool:
    return (ansible_dir(workspace) / "ansible.cfg").exists()


# ── Runtime detection ─────────────────────────────────────────────────────────

def _repo_files(source_dir: Path, pattern: str):
    for path in source_dir.rglob(pattern):
        rel = path.relative_to(source_dir)
        if len(rel.parts) <= 4 and not any(part in _SKIP_DIRS for part in rel.parts):
            yield path


def detect_runtime(source_dir: Path) -> dict[str, Any]:
    """How to install and start the app on a plain Ubuntu server.

    Supports Django, FastAPI and Flask (Python) and Node apps with a start
    script. Raises AnsibleError for anything else.
    """
    # Django: manage.py next to a <project>/wsgi.py
    for manage in sorted(_repo_files(source_dir, "manage.py"), key=lambda p: len(p.parts)):
        wsgi = next(iter(sorted(manage.parent.glob("*/wsgi.py"))), None)
        if wsgi:
            return _python_runtime(source_dir, manage.parent, 8000,
                                   f"gunicorn {wsgi.parent.name}.wsgi:application --bind 127.0.0.1:8000",
                                   "gunicorn")
    # FastAPI / Flask: module-level app object
    apps = []
    for py in _repo_files(source_dir, "*.py"):
        try:
            text = py.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        match = re.search(r"^(\w+)\s*=\s*(FastAPI|Flask)\(", text, re.MULTILINE)
        if match:
            apps.append((len(py.parts), py, match.group(1), match.group(2)))
    if apps:
        _, app_file, variable, framework = min(apps, key=lambda a: a[0])
        target = f"{app_file.stem}:{variable}"
        if framework == "FastAPI":
            return _python_runtime(source_dir, app_file.parent, 8000,
                                   f"uvicorn {target} --host 127.0.0.1 --port 8000", "uvicorn")
        return _python_runtime(source_dir, app_file.parent, 8000,
                               f"gunicorn {target} --bind 127.0.0.1:8000", "gunicorn")
    # Node: package.json with a start script, preferring backend folders
    manifests = []
    for manifest in _repo_files(source_dir, "package.json"):
        try:
            scripts = json.loads(manifest.read_text(encoding="utf-8")).get("scripts") or {}
        except (OSError, ValueError):
            continue
        if "start" in scripts:
            preferred = manifest.parent.name.lower() in ("backend", "api", "server")
            manifests.append((0 if preferred else 1, len(manifest.parts), manifest, "build" in scripts))
    if manifests:
        _, _, manifest, has_build = min(manifests, key=lambda m: (m[0], m[1]))
        return {
            "runtime": "node",
            "workdir": manifest.parent.relative_to(source_dir).as_posix(),
            "port": 3000,
            "start_command": "/usr/bin/npm start",
            "build": has_build,
            "requirements": "",
            "server_package": "",
        }
    raise AnsibleError(
        "Server deployment supports Django, FastAPI, Flask and Node.js apps. "
        "No supported application entry point was found in this repository."
    )


def _python_runtime(source_dir: Path, workdir: Path, port: int, command: str, server: str) -> dict[str, Any]:
    requirements = next(
        (p for p in (workdir / "requirements.txt", source_dir / "requirements.txt") if p.exists()), None
    )
    return {
        "runtime": "python",
        "workdir": workdir.relative_to(source_dir).as_posix(),
        "port": port,
        "start_command": command,
        "build": False,
        "requirements": requirements.relative_to(source_dir).as_posix() if requirements else "",
        "server_package": server,
    }


# ── SSH key and worker IP ─────────────────────────────────────────────────────

def _generate_ssh_key() -> tuple[str, str]:
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

    key = Ed25519PrivateKey.generate()
    private = key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.OpenSSH, serialization.NoEncryption()
    ).decode()
    public = key.public_key().public_bytes(
        serialization.Encoding.OpenSSH, serialization.PublicFormat.OpenSSH
    ).decode()
    return private, public + " infragenie"


def worker_public_ip() -> str:
    """Public IP the worker reaches AWS from; SSH is only opened to it."""
    try:
        with urllib.request.urlopen("https://checkip.amazonaws.com", timeout=10) as response:
            ip = response.read().decode().strip()
    except OSError as exc:
        raise AnsibleError(f"Could not determine this worker's public IP for the SSH rule: {exc}") from exc
    if not re.fullmatch(r"\d{1,3}(?:\.\d{1,3}){3}", ip):
        raise AnsibleError(f"Unexpected public IP response: {ip!r}")
    return ip


# ── Workspace generation ──────────────────────────────────────────────────────

_ANSIBLE_CFG = """\
[defaults]
inventory = inventory.ini
roles_path = roles
host_key_checking = False
retry_files_enabled = False
interpreter_python = auto_silent
timeout = 30
forks = 10

[ssh_connection]
pipelining = True
ssh_args = -o ControlMaster=auto -o ControlPersist=60s -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null
"""

_PLAYBOOKS = {
    "deploy": """\
- name: Deploy application
  hosts: app
  become: true
  gather_facts: false
  pre_tasks:
    # A new server accepts SSH before it allows logins (pam_nologin while
    # booting); retry until a real session works.
    - name: Wait until the server accepts logins
      ansible.builtin.wait_for_connection:
        timeout: 300
    - name: Gather facts
      ansible.builtin.setup:
  roles:
    - common
  tasks:
    # The runtime role depends on a host variable, so it is included at run time.
    - name: Install the language runtime
      ansible.builtin.include_role:
        name: "{{ app_runtime }}"
    - name: Install and start the application
      ansible.builtin.import_role:
        name: app
    - name: Put nginx in front of the application
      ansible.builtin.import_role:
        name: nginx
  post_tasks:
    - name: Wait for the application to answer
      ansible.builtin.uri:
        url: "http://127.0.0.1:{{ app_port }}{{ health_path }}"
        status_code: [200, 201, 204, 301, 302, 401, 403, 404]
      register: app_health
      retries: 20
      delay: 3
      until: app_health is succeeded
""",
    "restart": """\
- name: Restart application
  hosts: app
  become: true
  tasks:
    - name: Restart the service
      ansible.builtin.systemd_service:
        name: "{{ app_name }}"
        state: restarted
""",
    "health_check": """\
- name: Health check
  hosts: app
  become: true
  tasks:
    - name: Service status
      ansible.builtin.command: systemctl is-active {{ app_name }}
      register: service_state
      changed_when: false
      failed_when: false
    - name: Application port
      ansible.builtin.uri:
        url: "http://127.0.0.1:{{ app_port }}{{ health_path }}"
        status_code: [200, 201, 204, 301, 302, 401, 403, 404]
      register: app_check
      failed_when: false
    - name: Through nginx
      ansible.builtin.uri:
        url: "http://127.0.0.1/"
        status_code: [200, 201, 204, 301, 302, 401, 403, 404]
      register: nginx_check
      failed_when: false
    - name: Summary
      ansible.builtin.debug:
        msg:
          - "service: {{ service_state.stdout }}"
          - "app port {{ app_port }}: {{ app_check.status | default('unreachable') }}"
          - "nginx :80: {{ nginx_check.status | default('unreachable') }}"
    - name: Fail when unhealthy
      ansible.builtin.fail:
        msg: The application is not healthy.
      when: service_state.stdout != 'active' or (app_check.status | default(0)) == 0
""",
    "logs": """\
- name: Show application logs
  hosts: app
  become: true
  tasks:
    - name: Read the last 200 log lines
      ansible.builtin.command: journalctl -u {{ app_name }} -n 200 --no-pager
      register: app_logs
      changed_when: false
    - name: Logs
      ansible.builtin.debug:
        var: app_logs.stdout_lines
""",
    "update_os": """\
- name: Update OS packages
  hosts: app
  become: true
  tasks:
    - name: Upgrade packages
      ansible.builtin.apt:
        update_cache: true
        upgrade: dist
        autoremove: true
    - name: Check whether a reboot is required
      ansible.builtin.stat:
        path: /var/run/reboot-required
      register: reboot_flag
    - name: Reboot status
      ansible.builtin.debug:
        msg: "{{ 'A reboot is required to finish the update.' if reboot_flag.stat.exists else 'No reboot required.' }}"
""",
}

_ROLES = {
    "common/tasks/main.yml": """\
- name: Wait for first-boot setup (cloud-init) to finish
  ansible.builtin.command: cloud-init status --wait
  changed_when: false
  failed_when: false

- name: Install base packages
  ansible.builtin.apt:
    name: [git, curl, ca-certificates, acl, unzip]
    update_cache: true
    cache_valid_time: 3600

- name: Create the application user
  ansible.builtin.user:
    name: "{{ app_user }}"
    system: true
    shell: /usr/sbin/nologin
    home: "{{ app_dir }}"
    create_home: true
""",
    "python/tasks/main.yml": """\
- name: Install Python tooling
  ansible.builtin.apt:
    name: [python3, python3-venv, python3-pip, python3-dev, build-essential, libpq-dev]
""",
    "node/tasks/main.yml": """\
- name: Check installed Node.js version
  ansible.builtin.command: node --version
  register: node_version
  changed_when: false
  failed_when: false

- name: Add the NodeSource repository (Node.js 20)
  ansible.builtin.shell: curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  when: node_version.rc != 0 or not node_version.stdout.startswith('v20')

- name: Install Node.js
  ansible.builtin.apt:
    name: nodejs
    update_cache: true
""",
    "app/tasks/main.yml": """\
- name: Create the source directory
  ansible.builtin.file:
    path: "{{ app_dir }}/src"
    state: directory
    owner: "{{ app_user }}"
    group: "{{ app_user }}"

- name: Fetch the code from Git
  ansible.builtin.git:
    repo: "{{ app_repo }}"
    dest: "{{ app_dir }}/src"
    depth: 1
    force: true
  become_user: "{{ app_user }}"
  when: app_source == 'git'
  notify: Restart app

- name: Unpack the uploaded archive
  ansible.builtin.unarchive:
    src: "{{ playbook_dir }}/../files/source.zip"
    dest: "{{ app_dir }}/src"
  when: app_source == 'archive'
  notify: Restart app

- name: Hand the code to the application user
  ansible.builtin.file:
    path: "{{ app_dir }}"
    owner: "{{ app_user }}"
    group: "{{ app_user }}"
    recurse: true

- name: Write the environment file
  ansible.builtin.template:
    src: app.env.j2
    dest: "/etc/{{ app_name }}.env"
    owner: root
    group: "{{ app_user }}"
    mode: "0640"
  notify: Restart app

- name: Install Python dependencies
  ansible.builtin.pip:
    requirements: "{{ app_dir }}/src/{{ app_requirements }}"
    virtualenv: "{{ app_dir }}/venv"
    virtualenv_command: python3 -m venv
  become_user: "{{ app_user }}"
  when: app_runtime == 'python' and app_requirements
  notify: Restart app

- name: Install the application server
  ansible.builtin.pip:
    name: "{{ app_server_package }}"
    virtualenv: "{{ app_dir }}/venv"
    virtualenv_command: python3 -m venv
  become_user: "{{ app_user }}"
  when: app_runtime == 'python'

- name: Install Node dependencies
  ansible.builtin.shell: npm ci || npm install
  args:
    chdir: "{{ app_dir }}/src/{{ app_workdir }}"
  become_user: "{{ app_user }}"
  environment:
    HOME: "{{ app_dir }}"
  when: app_runtime == 'node'
  notify: Restart app

- name: Build the Node app
  ansible.builtin.command: npm run build
  args:
    chdir: "{{ app_dir }}/src/{{ app_workdir }}"
  become_user: "{{ app_user }}"
  environment:
    HOME: "{{ app_dir }}"
  when: app_runtime == 'node' and app_build

- name: Install the systemd service
  ansible.builtin.template:
    src: app.service.j2
    dest: "/etc/systemd/system/{{ app_name }}.service"
    mode: "0644"
  notify: Restart app

- name: Start the service on boot
  ansible.builtin.systemd_service:
    name: "{{ app_name }}"
    enabled: true
    state: started
    daemon_reload: true
""",
    "app/handlers/main.yml": """\
- name: Restart app
  ansible.builtin.systemd_service:
    name: "{{ app_name }}"
    state: restarted
    daemon_reload: true
""",
    "app/templates/app.env.j2": """\
# Managed by InfraGenie (Ansible). Changes are overwritten on the next deploy.
PORT={{ app_port }}
{% for key, value in app_env.items() %}
{{ key }}={{ value }}
{% endfor %}
""",
    "app/templates/app.service.j2": """\
[Unit]
Description={{ app_name }} (managed by InfraGenie)
After=network-online.target
Wants=network-online.target

[Service]
User={{ app_user }}
Group={{ app_user }}
WorkingDirectory={{ app_dir }}/src/{{ app_workdir }}
EnvironmentFile=/etc/{{ app_name }}.env
Environment=PATH={{ app_dir }}/venv/bin:/usr/local/bin:/usr/bin:/bin
ExecStart={{ app_start_command }}
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
""",
    "nginx/tasks/main.yml": """\
- name: Install nginx
  ansible.builtin.apt:
    name: nginx

- name: Configure the site
  ansible.builtin.template:
    src: site.conf.j2
    dest: "/etc/nginx/sites-available/{{ app_name }}"
    mode: "0644"
  notify: Reload nginx

- name: Enable the site
  ansible.builtin.file:
    src: "/etc/nginx/sites-available/{{ app_name }}"
    dest: "/etc/nginx/sites-enabled/{{ app_name }}"
    state: link
  notify: Reload nginx

- name: Disable the default site
  ansible.builtin.file:
    path: /etc/nginx/sites-enabled/default
    state: absent
  notify: Reload nginx

- name: Start nginx
  ansible.builtin.systemd_service:
    name: nginx
    enabled: true
    state: started
""",
    "nginx/handlers/main.yml": """\
- name: Reload nginx
  ansible.builtin.systemd_service:
    name: nginx
    state: reloaded
""",
    "nginx/templates/site.conf.j2": """\
# Managed by InfraGenie (Ansible).
server {
    listen 80 default_server;
    server_name _;
    client_max_body_size 50m;

    location / {
        proxy_pass http://127.0.0.1:{{ app_port }};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 300;
    }
}
""",
}


def _write_lf(path: Path, text: str, encoding: str = "utf-8") -> None:
    """Write with LF line endings: these files are used on Linux by ssh,
    systemd and nginx, which reject or misread CRLF (Windows) endings."""
    path.write_bytes(text.replace("\r\n", "\n").encode(encoding))


def _yaml_scalar(value: Any) -> str:
    return json.dumps(value)  # JSON scalars are valid YAML


def prepare_workspace(
    workspace: Path,
    *,
    app_name: str,
    source: str,
    source_dir: Path,
    health_path: str = "/",
) -> dict[str, str]:
    """Generate the Ansible project for a deployment.

    Returns Terraform variables the server template needs:
    ``ssh_public_key`` and ``admin_cidr`` (the worker's IP).
    """
    runtime = detect_runtime(source_dir)
    root = ansible_dir(workspace)
    shutil.rmtree(root, ignore_errors=True)
    (root / "group_vars" / "all").mkdir(parents=True)
    (root / "playbooks").mkdir()
    (root / ".ssh").mkdir()

    _write_lf(root / "ansible.cfg", _ANSIBLE_CFG)
    _write_lf(root / "inventory.ini", "# The server address is filled in after Terraform creates it.\n[app]\n")
    for playbook, content in _PLAYBOOKS.items():
        _write_lf(root / "playbooks" / f"{playbook}.yml", content)
    for rel, content in _ROLES.items():
        path = root / "roles" / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        _write_lf(path, content)

    service = re.sub(r"[^a-z0-9-]", "-", app_name.lower()).strip("-") or "app"
    git = source.startswith(("http://", "https://", "git@", "ssh://"))
    if not git:
        (root / "files").mkdir()
        shutil.copy(source, root / "files" / "source.zip")
    settings = {
        "app_name": service,
        "app_user": service,
        "app_dir": f"/opt/{service}",
        "app_runtime": runtime["runtime"],
        "app_source": "git" if git else "archive",
        "app_repo": source if git else "",
        "app_workdir": runtime["workdir"] if runtime["workdir"] != "." else "",
        "app_port": runtime["port"],
        "app_start_command": (
            f"{{{{ app_dir }}}}/venv/bin/{runtime['start_command']}"
            if runtime["runtime"] == "python" else runtime["start_command"]
        ),
        "app_requirements": runtime["requirements"],
        "app_server_package": runtime["server_package"],
        "app_build": runtime["build"],
        "health_path": health_path or "/",
    }
    _write_lf(
        root / "group_vars" / "all" / "main.yml",
        "# Application settings (generated by InfraGenie).\n"
        + "".join(f"{key}: {_yaml_scalar(value)}\n" for key, value in settings.items()),
    )
    write_secrets(workspace, {})

    private_key, public_key = _generate_ssh_key()
    key_path = root / ".ssh" / "id_ed25519"
    _write_lf(key_path, private_key)
    return {"ssh_public_key": public_key, "admin_cidr": f"{worker_public_ip()}/32"}


def write_secrets(workspace: Path, app_env: dict[str, str]) -> None:
    body = "# Application environment (generated by InfraGenie). Redacted in the UI.\napp_env:\n"
    body += "".join(f"  {key}: {_yaml_scalar(str(value))}\n" for key, value in app_env.items()) or ""
    if not app_env:
        body = body.replace("app_env:\n", "app_env: {}\n")
    _write_lf(ansible_dir(workspace) / "group_vars" / "all" / "secrets.yml", body)


def write_inventory(workspace: Path, host: str) -> None:
    _write_lf(
        ansible_dir(workspace) / "inventory.ini",
        "# Managed by InfraGenie.\n[app]\n"
        f"server1 ansible_host={host} ansible_user={SSH_USER} "
        "ansible_ssh_private_key_file=.ssh/id_ed25519\n",
    )


# ── Running playbooks ─────────────────────────────────────────────────────────

def ensure_image() -> None:
    """Build the Ansible runner image once per worker host."""
    probe = subprocess.run(["docker", "image", "inspect", IMAGE], capture_output=True, check=False)
    if probe.returncode == 0:
        return
    logger.info("[ANSIBLE] building runner image %s", IMAGE)
    result = subprocess.run(
        ["docker", "build", "-t", IMAGE, str(_DOCKERFILE_DIR)],
        capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=900, check=False,
    )
    if result.returncode != 0:
        raise AnsibleError("Could not build the Ansible runner image: " + (result.stderr or result.stdout)[-1500:])


def run_playbook(
    workspace: Path,
    playbook: str,
    on_output: Optional[Callable[[str], None]] = None,
) -> tuple[int, str]:
    """Run a built-in playbook in the runner container; returns (exit code, output)."""
    if playbook not in BUILTIN_PLAYBOOKS:
        raise AnsibleError(f"Unknown playbook {playbook!r}.")
    root = ansible_dir(workspace)
    if not has_ansible(workspace):
        raise AnsibleError("This deployment has no Ansible configuration.")
    if "ansible_host=" not in (root / "inventory.ini").read_text(encoding="utf-8"):
        raise AnsibleError("The server has not been created yet, so there is nothing to run against.")
    ensure_image()
    script = (
        "cp -r /src/. /tmp/ws && cd /tmp/ws && chmod 700 .ssh && chmod 600 .ssh/id_ed25519 "
        f"&& ANSIBLE_CONFIG=/tmp/ws/ansible.cfg ansible-playbook playbooks/{playbook}.yml"
    )
    process = subprocess.Popen(
        ["docker", "run", "--rm", "-v", f"{root}:/src:ro", IMAGE, "sh", "-c", script],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace",
    )
    lines: list[str] = []
    assert process.stdout is not None
    for line in process.stdout:
        lines.append(line)
        if on_output:
            on_output(line)
    try:
        code = process.wait(timeout=_RUN_TIMEOUT)
    except subprocess.TimeoutExpired:
        process.kill()
        code = -1
        lines.append(f"\n[InfraGenie] Playbook timed out after {_RUN_TIMEOUT}s.\n")
    return code, "".join(lines)


def parse_recap(output: str) -> dict[str, dict[str, int]]:
    """PLAY RECAP lines -> {host: {ok, changed, unreachable, failed, ...}}."""
    recap: dict[str, dict[str, int]] = {}
    section = output.split("PLAY RECAP", 1)[-1] if "PLAY RECAP" in output else ""
    for host, stats in re.findall(r"^(\S+)\s+:\s+(.+)$", section, re.MULTILINE):
        recap[host] = {key: int(value) for key, value in re.findall(r"(\w+)=(\d+)", stats)}
    return recap


# ── Files for the UI ──────────────────────────────────────────────────────────

def list_files(workspace: Path) -> list[dict[str, Any]]:
    root = ansible_dir(workspace)
    if not root.exists():
        return []
    files = []
    for path in sorted(root.rglob("*")):
        rel = path.relative_to(root).as_posix()
        if path.is_dir() or rel.startswith(".ssh/") or rel.startswith("files/"):
            continue
        files.append({"path": rel, "size": path.stat().st_size, "redacted": rel in _SECRET_FILES})
    return files


def read_file(workspace: Path, rel: str) -> str:
    root = ansible_dir(workspace).resolve()
    target = (root / rel).resolve()
    try:
        relative = target.relative_to(root).as_posix()
    except ValueError as exc:
        raise AnsibleError("Invalid file path.") from exc
    if relative.startswith((".ssh/", "files/")) or not target.is_file():
        raise AnsibleError("File not found.")
    text = target.read_text(encoding="utf-8", errors="replace")
    if relative in _SECRET_FILES:
        text = re.sub(r"^(\s+\w+):\s.*$", r'\1: "********"', text, flags=re.MULTILINE)
    return text
