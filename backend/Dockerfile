FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y \
    libreoffice \
    libreoffice-writer \
    default-jre-headless \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN mkdir -p /data/generated /data/templates

ENV TEMPLATES_DIR=/data/templates
ENV GENERATED_DIR=/data/generated

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=5 \
    CMD curl -f http://localhost:8000/api/health || exit 1

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
