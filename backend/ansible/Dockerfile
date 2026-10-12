# Ansible control node for InfraGenie.
#
# Ansible cannot run natively on Windows, so the worker runs every playbook in
# this container. The deployment's ansible/ directory is mounted read-only at
# /src and copied to /tmp/ws inside the container (Windows bind mounts are
# world-writable, which makes Ansible ignore ansible.cfg and ssh refuse keys).
#
# Built automatically by ansible_engine.ensure_image() (the worker checks at
# startup); the image tag is a hash of this file, so edits trigger a rebuild.
FROM python:3.12-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends openssh-client \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir "ansible-core>=2.17,<2.18"

ENV ANSIBLE_HOST_KEY_CHECKING=False \
    ANSIBLE_FORCE_COLOR=0 \
    PYTHONUNBUFFERED=1

WORKDIR /tmp/ws

# InfraGenie runs one command per playbook (`docker run --rm ... sh -c ...`),
# which overrides this. Started on its own (e.g. from Docker Desktop) the
# container stays up so you can open a shell and use ansible by hand:
#   docker exec -it <container> bash
CMD ["sleep", "infinity"]
