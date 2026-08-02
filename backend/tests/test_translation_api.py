import io
from pathlib import Path

from fastapi.testclient import TestClient

from backend.app import app


client = TestClient(app)


def test_health_and_upload_routes():
    response = client.get('/api/v1/health')
    assert response.status_code == 200
    assert response.json()['status'] == 'ok'

    pdf_bytes = b'%PDF-1.4\n1 0 obj\n<< /Type /Catalog >> endobj\n%%EOF'
    upload_response = client.post(
        '/api/v1/uploads',
        files={'file': ('sample.pdf', io.BytesIO(pdf_bytes), 'application/pdf')},
    )
    assert upload_response.status_code == 200
    payload = upload_response.json()
    assert payload['code'] == 0
    assert payload['data']['filename'] == 'sample.pdf'


def test_job_creation_and_status_flow():
    pdf_bytes = b'%PDF-1.4\n1 0 obj\n<< /Type /Catalog >> endobj\n%%EOF'
    upload_response = client.post(
        '/api/v1/uploads',
        files={'file': ('sample2.pdf', io.BytesIO(pdf_bytes), 'application/pdf')},
    )
    upload_id = upload_response.json()['data']['upload_id']

    create_job_response = client.post(
        '/api/v1/jobs',
        json={
            'workflow': 'book',
            'source': {'upload_id': upload_id},
            'target_lang': 'vi',
            'provider': 'mock',
        },
    )
    assert create_job_response.status_code == 200
    job_id = create_job_response.json()['data']['job_id']

    detail_response = client.get(f'/api/v1/jobs/{job_id}')
    assert detail_response.status_code == 200
    assert detail_response.json()['data']['job_id'] == job_id
