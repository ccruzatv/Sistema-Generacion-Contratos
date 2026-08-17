import threading
import time
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from .database import SessionLocal
from .models import DraftSubmission, User
from .services.email_service import send_reminder_email

REMINDER_DAYS = [3, 5]


def _check_reminders():
    db: Session = SessionLocal()
    try:
        now = datetime.now()
        pending = db.query(DraftSubmission).filter(DraftSubmission.status == "pendiente").all()
        admins = db.query(User).filter(User.role == "admin", User.is_active == 1).all()

        for days in REMINDER_DAYS:
            threshold = now - timedelta(days=days)
            # Filtrar docs pendientes por rango de dias
            docs_in_range = [
                s for s in pending
                if s.submitted_at <= threshold and (now - s.submitted_at).days < (days + 2)
            ]

            # Agrupar por jurisdiccion del operativo que envio
            for admin in admins:
                docs_to_remind = [
                    {
                        "document_name": s.document.document_name if s.document else "Sin nombre",
                        "submitter": s.document.user.name if s.document and s.document.user else "Desconocido",
                        "days": (now - s.submitted_at).days,
                    }
                    for s in docs_in_range
                    if s.document and s.document.user and s.document.user.jurisdiccion == admin.jurisdiccion
                ]

                if docs_to_remind:
                    send_reminder_email(
                        to_email=admin.email,
                        admin_name=admin.name,
                        pending_docs=docs_to_remind,
                    )
                    print(f"[SCHEDULER] Recordatorio {days} dias enviado a {admin.email} ({len(docs_to_remind)} docs)")
    except Exception as e:
        print(f"[SCHEDULER] Error: {e}")
    finally:
        db.close()


def _run_scheduler():
    while True:
        now = datetime.now()
        # Ejecutar todos los dias a las 09:00
        next_run = now.replace(hour=9, minute=0, second=0, microsecond=0)
        if now >= next_run:
            next_run += timedelta(days=1)
        wait_seconds = (next_run - now).total_seconds()
        print(f"[SCHEDULER] Proximo recordatorio en {wait_seconds/3600:.1f} horas")
        time.sleep(wait_seconds)
        _check_reminders()


def start_scheduler():
    thread = threading.Thread(target=_run_scheduler, daemon=True)
    thread.start()
    print("[SCHEDULER] Iniciado - recordatorios a los 3 y 5 dias")
