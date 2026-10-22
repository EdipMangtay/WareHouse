# 任何能跑 container 的平台 (Fly.io / Railway / Cloud Run) 都可用
FROM python:3.11-slim
WORKDIR /workspace
COPY apps/api/requirements.lock ./requirements.lock
RUN pip install --no-cache-dir -r requirements.lock
COPY apps/api/app ./apps/api/app
COPY packages ./packages
COPY shared ./shared
COPY experiments/scenarios ./experiments/scenarios
WORKDIR /workspace/apps/api
ENV TWIN_DB=/tmp/twin.db PORT=8000
EXPOSE 8000
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
