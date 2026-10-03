FROM python:3.11-slim-bookworm

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    git curl gnupg ca-certificates \
    && install -d -m 0755 /usr/share/keyrings \
    && curl -fsSL https://apt.releases.hashicorp.com/gpg \
       | gpg --dearmor -o /usr/share/keyrings/hashicorp-archive-keyring.gpg \
    && chmod 0644 /usr/share/keyrings/hashicorp-archive-keyring.gpg \
    && . /etc/os-release \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] https://apt.releases.hashicorp.com ${VERSION_CODENAME} main" \
       > /etc/apt/sources.list.d/hashicorp.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends terraform \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Dev reload is fine — but exclude every data directory so uploaded/extracted
# files never trigger a server restart. In production, drop --reload entirely.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--reload", \
     "--reload-exclude", "uploads/*", "--reload-exclude", "deployment_output/*", \
     "--reload-exclude", "infragenie-repos/*"]
