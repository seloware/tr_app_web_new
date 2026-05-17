@echo off
echo TransLingua PDF Servisi baslatiliyor...
python -m uvicorn main:app --port 5050 --reload
pause
