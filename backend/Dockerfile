FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Dev reload is fine — but exclude every data directory so uploaded/extracted
# files never trigger a server restart. In production, drop --reload entirely.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--reload", \
     "--reload-exclude", "uploads/*", "--reload-exclude", "deployment_output/*", \
     "--reload-exclude", "infragenie-repos/*"]
