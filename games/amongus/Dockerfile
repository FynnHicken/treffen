FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt /app/
RUN pip install --no-cache-dir -r requirements.txt

COPY . /app/

ENV PORT=8093
ENV HOST=0.0.0.0

EXPOSE 8093

CMD ["python", "server/main.py"]
