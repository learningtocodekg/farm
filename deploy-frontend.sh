#!/bin/bash

# Deploy from source
gcloud run deploy frontend --source . --port 8080 --allow-unauthenticated --project uoo-quackathon26eug-8256

# Rename it back
mv Dockerfile Dockerfile.frontend
