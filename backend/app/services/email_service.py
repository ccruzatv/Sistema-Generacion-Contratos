import os
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

SMTP_HOST = os.getenv("SMTP_HOST", "")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
SMTP_FROM = os.getenv("SMTP_FROM", "sgac@pjud.cl")
APP_URL = os.getenv("APP_URL", "http://localhost:5173")
SMTP_BCC = os.getenv("SMTP_BCC", "sgac@pjud.cl")

_FROM_HEADER = "Sistema de Generacion Automatizada de Contratos <sgac@pjud.cl>"


def _html(body):
    return f"""<html><body style="margin:0;padding:0;background-color:#f0f3f8;">
<table width="600" cellpadding="0" cellspacing="0" border="0" align="center" style="font-family:Century Gothic,Arial,sans-serif;color:#112d86;">
  <tr><td style="background-color:#112d86;padding:10px 20px;text-align:center;">
    <h1 style="color:white;margin:0;font-size:16px;">Sistema de Generaci&#243;n Automatizada de Contratos (SGAC)</h1>
    <p style="color:#a8b8d8;margin:4px 0 0;font-size:11px;">Subdepartamento de Mejoramiento Continuo - DEPLAN</p>
  </td></tr>
  <tr><td style="background-color:#c8a84e;height:3px;"></td></tr>
  <tr><td style="background-color:#f0f3f8;padding:12px 20px;">{body}</td></tr>
  <tr><td style="background-color:#c8a84e;height:3px;"></td></tr>
  <tr><td style="background-color:#e8edf5;padding:10px 20px;">
    <p style="color:#112d86;font-size:11px;margin:0;">Este es un mensaje autom&#225;tico generado por el Sistema SGAC. En caso de consultas relacionadas con esta notificaci&#243;n, favor responder directamente a este correo.</p>
  </td></tr>
  <tr><td style="background-color:#112d86;padding:10px;text-align:center;">
    <p style="color:#ffffff;font-size:11px;margin:0;">Desarrollado por Mejoramiento Continuo</p>
    <p style="color:#a8b8d8;font-size:10px;margin:3px 0 0;">Corporaci&#243;n Administrativa del Poder Judicial</p>
  </td></tr>
</table>
</body></html>"""


def _send(recipients, msg):
    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as s:
            s.ehlo()
            if SMTP_PORT == 587:
                s.starttls()
                s.ehlo()
            s.login(SMTP_USER, SMTP_PASSWORD)
            s.sendmail(SMTP_FROM, recipients, msg.as_string())
        return True
    except Exception as e:
        print(f"[EMAIL] Error: {e}")
        return False


def send_invitation_email(to_email, user_name, temp_password, role):
    if not SMTP_HOST or not SMTP_USER:
        print(f"[EMAIL] SMTP no configurado: {to_email}")
        return False
    subject = "Invitacion al Sistema SGAC - Poder Judicial"
    body = f"""<p style="font-size:14px;font-weight:bold;margin:0 0 6px 0;">Bienvenido(a), {user_name}</p>
<p style="margin:0 0 6px 0;font-size:12px;">Ha sido invitado(a) al Sistema de Generación Automatizada de Contratos (SGAC) del Poder Judicial de Chile.</p>
<table width="100%" cellpadding="0" cellspacing="0" border="1" style="border-collapse:collapse;border-color:#112d86;margin:8px 0;">
  <tr><td colspan="2" style="padding:5px 10px;background-color:#112d86;"><span style="color:white;font-size:12px;font-weight:bold;">Sus credenciales de acceso:</span></td></tr>
  <tr><td style="padding:5px 10px;font-weight:bold;color:#112d86;font-size:12px;width:40%;background-color:white;">Correo electrónico:</td><td style="padding:5px 10px;font-size:12px;background-color:white;">{to_email}</td></tr>
  <tr><td style="padding:5px 10px;font-weight:bold;color:#112d86;font-size:12px;background-color:#f9f9f9;">Contraseña:</td><td style="padding:5px 10px;font-family:monospace;font-size:14px;color:#8b2332;background-color:#f9f9f9;">{temp_password}</td></tr>
  <tr><td style="padding:5px 10px;font-weight:bold;color:#112d86;font-size:12px;background-color:white;">Rol asignado:</td><td style="padding:5px 10px;font-size:12px;text-transform:capitalize;background-color:white;">{role}</td></tr>
</table>
<p style="margin:6px 0 0 0;font-size:12px;">Acceda al sistema en: <a href="{APP_URL}/login" style="color:#112d86;font-weight:bold;">{APP_URL}/login</a></p>"""
    text = f"Bienvenido(a), {user_name}\n\nCredenciales:\n- Correo: {to_email}\n- Contraseña: {temp_password}\n- Rol: {role}\n\nAcceda en: {APP_URL}/login\n\nEste es un mensaje automático del Sistema SGAC.\n---\nDesarrollado por Mejoramiento Continuo\nCorporación Administrativa del Poder Judicial"
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = _FROM_HEADER
    msg["To"] = to_email
    msg["Bcc"] = SMTP_BCC
    msg.attach(MIMEText(text, "plain", "utf-8"))
    msg.attach(MIMEText(_html(body), "html", "utf-8"))
    return _send([to_email, SMTP_BCC], msg)


def send_draft_notification_email(to_email, admin_name, submitter_name, document_name):
    if not SMTP_HOST or not SMTP_USER:
        print(f"[EMAIL] SMTP no configurado: {to_email}")
        return False
    subject = f"Nuevo borrador para revisión - {document_name} | SGAC"
    body = f"""<p style="font-size:12px;margin:0 0 6px 0;">Estimado(a) <strong>{admin_name}</strong>,</p>
<p style="font-size:12px;margin:0 0 6px 0;">El usuario <strong>{submitter_name}</strong> ha enviado un borrador para su revisión.</p>
<table width="100%" cellpadding="0" cellspacing="0" border="1" style="border-collapse:collapse;border-color:#112d86;margin:8px 0;">
  <tr><td colspan="2" style="padding:5px 10px;background-color:#112d86;"><span style="color:white;font-size:12px;font-weight:bold;">Detalle del documento:</span></td></tr>
  <tr><td style="padding:5px 10px;font-weight:bold;color:#112d86;font-size:12px;width:40%;background-color:white;">Nombre:</td><td style="padding:5px 10px;font-size:12px;background-color:white;">{document_name}</td></tr>
  <tr><td style="padding:5px 10px;font-weight:bold;color:#112d86;font-size:12px;background-color:#f9f9f9;">Enviado por:</td><td style="padding:5px 10px;font-size:12px;background-color:#f9f9f9;">{submitter_name}</td></tr>
</table>
<p style="margin:6px 0 0 0;font-size:12px;">Revise en: <a href="{APP_URL}/admin/reviews" style="color:#112d86;font-weight:bold;">{APP_URL}/admin/reviews</a></p>"""
    text = f"Estimado(a) {admin_name},\n\nEl usuario {submitter_name} envió un borrador para revisión.\n\nDocumento: {document_name}\n\nRevise en: {APP_URL}/admin/reviews\n\nEste es un mensaje automático del Sistema SGAC.\n---\nDesarrollado por Mejoramiento Continuo\nCorporación Administrativa del Poder Judicial"
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = _FROM_HEADER
    msg["To"] = to_email
    msg["Bcc"] = SMTP_BCC
    msg.attach(MIMEText(text, "plain", "utf-8"))
    msg.attach(MIMEText(_html(body), "html", "utf-8"))
    return _send([to_email, SMTP_BCC], msg)


def send_approval_email(to_email, user_name, document_name):
    if not SMTP_HOST or not SMTP_USER:
        print(f"[EMAIL] SMTP no configurado: aprobacion para {to_email}")
        return False
    subject = f"Documento aprobado - {document_name} | SGAC"
    body = f"""<p style="font-size:14px;font-weight:bold;margin:0 0 6px 0;">Estimado(a), {user_name}</p>
<p style="margin:0 0 6px 0;font-size:12px;">Le informamos que su documento ha sido <strong style="color:#2e7d32;">aprobado</strong> satisfactoriamente.</p>
<table width="100%" cellpadding="0" cellspacing="0" border="1" style="border-collapse:collapse;border-color:#112d86;margin:8px 0;">
  <tr><td colspan="2" style="padding:5px 10px;background-color:#2e7d32;"><span style="color:white;font-size:12px;font-weight:bold;">Detalle del documento:</span></td></tr>
  <tr><td style="padding:5px 10px;font-weight:bold;color:#112d86;font-size:12px;width:40%;background-color:white;">Nombre:</td><td style="padding:5px 10px;font-size:12px;background-color:white;">{document_name}</td></tr>
  <tr><td style="padding:5px 10px;font-weight:bold;color:#112d86;font-size:12px;background-color:#f9f9f9;">Estado:</td><td style="padding:5px 10px;font-size:12px;color:#2e7d32;font-weight:bold;background-color:#f9f9f9;">Aprobado</td></tr>
</table>
<p style="margin:6px 0 0 0;font-size:12px;">Puede descargar el documento final directamente en el <strong>Expediente</strong>: <a href="{APP_URL}" style="color:#112d86;font-weight:bold;">{APP_URL}</a></p>"""
    text = f"Estimado(a) {user_name},\n\nSu documento '{document_name}' ha sido aprobado.\n\nDescargue el documento en: {APP_URL}\n\nEste es un mensaje automático del Sistema SGAC.\n---\nDesarrollado por Mejoramiento Continuo\nCorporación Administrativa del Poder Judicial"
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = _FROM_HEADER
    msg["To"] = to_email
    msg["Bcc"] = SMTP_BCC
    msg.attach(MIMEText(text, "plain", "utf-8"))
    msg.attach(MIMEText(_html(body), "html", "utf-8"))
    return _send([to_email, SMTP_BCC], msg)


def send_rejection_email(to_email, user_name, document_name, comment):
    if not SMTP_HOST or not SMTP_USER:
        print(f"[EMAIL] SMTP no configurado: rechazo para {to_email}")
        return False
    subject = f"Documento rechazado - {document_name} | SGAC"
    comment_row = f'<tr><td style="padding:5px 10px;font-weight:bold;color:#112d86;font-size:12px;background-color:#f9f9f9;">Motivo:</td><td style="padding:5px 10px;font-size:12px;background-color:#f9f9f9;">{comment}</td></tr>' if comment else ""
    body = f"""<p style="font-size:14px;font-weight:bold;margin:0 0 6px 0;">Estimado(a), {user_name}</p>
<p style="margin:0 0 6px 0;font-size:12px;">Le informamos que su documento ha sido <strong style="color:#8b2332;">rechazado</strong> y requiere correcciones.</p>
<table width="100%" cellpadding="0" cellspacing="0" border="1" style="border-collapse:collapse;border-color:#112d86;margin:8px 0;">
  <tr><td colspan="2" style="padding:5px 10px;background-color:#8b2332;"><span style="color:white;font-size:12px;font-weight:bold;">Detalle del documento:</span></td></tr>
  <tr><td style="padding:5px 10px;font-weight:bold;color:#112d86;font-size:12px;width:40%;background-color:white;">Nombre:</td><td style="padding:5px 10px;font-size:12px;background-color:white;">{document_name}</td></tr>
  <tr><td style="padding:5px 10px;font-weight:bold;color:#112d86;font-size:12px;background-color:#f9f9f9;">Estado:</td><td style="padding:5px 10px;font-size:12px;color:#8b2332;font-weight:bold;background-color:#f9f9f9;">Rechazado</td></tr>
  {comment_row}
</table>
<p style="margin:6px 0 0 0;font-size:12px;">Ingrese al sistema para corregir y reenviar el documento en su <strong>Expediente</strong>: <a href="{APP_URL}" style="color:#112d86;font-weight:bold;">{APP_URL}</a></p>"""
    text = f"Estimado(a) {user_name},\n\nSu documento '{document_name}' ha sido rechazado.\n\nMotivo: {comment or 'No especificado'}\n\nIngrese al sistema para corregir y reenviar: {APP_URL}\n\nEste es un mensaje automático del Sistema SGAC.\n---\nDesarrollado por Mejoramiento Continuo\nCorporación Administrativa del Poder Judicial"
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = _FROM_HEADER
    msg["To"] = to_email
    msg["Bcc"] = SMTP_BCC
    msg.attach(MIMEText(text, "plain", "utf-8"))
    msg.attach(MIMEText(_html(body), "html", "utf-8"))
    return _send([to_email, SMTP_BCC], msg)


def send_reminder_email(to_email, admin_name, pending_docs):
    if not SMTP_HOST or not SMTP_USER:
        print(f"[EMAIL] SMTP no configurado: recordatorio para {to_email}")
        return False
    days = pending_docs[0]["days"] if pending_docs else 0
    subject = f"Recordatorio: documentos pendientes de revisión hace {days} días | SGAC"
    rows = "".join([
        f'<tr><td style="padding:5px 10px;font-size:12px;background-color:{"white" if i%2==0 else "#f9f9f9"};">{d["document_name"]}</td><td style="padding:5px 10px;font-size:12px;background-color:{"white" if i%2==0 else "#f9f9f9"};">{d["submitter"]}</td><td style="padding:5px 10px;font-size:12px;font-weight:bold;color:#8b2332;background-color:{"white" if i%2==0 else "#f9f9f9"};">{d["days"]} días</td></tr>'
        for i, d in enumerate(pending_docs)
    ])
    body = f"""<p style="font-size:14px;font-weight:bold;margin:0 0 6px 0;">Estimado(a), {admin_name}</p>
<p style="margin:0 0 6px 0;font-size:12px;">Le informamos que los siguientes documentos llevan <strong>{days} o más días</strong> pendientes de revisión:</p>
<table width="100%" cellpadding="0" cellspacing="0" border="1" style="border-collapse:collapse;border-color:#112d86;margin:8px 0;">
  <tr><td style="padding:5px 10px;background-color:#112d86;"><span style="color:white;font-size:12px;font-weight:bold;">Documento</span></td><td style="padding:5px 10px;background-color:#112d86;"><span style="color:white;font-size:12px;font-weight:bold;">Enviado por</span></td><td style="padding:5px 10px;background-color:#112d86;"><span style="color:white;font-size:12px;font-weight:bold;">Tiempo pendiente</span></td></tr>
  {rows}
</table>
<p style="margin:6px 0 0 0;font-size:12px;">Revise los documentos en: <a href="{APP_URL}/admin/reviews" style="color:#112d86;font-weight:bold;">{APP_URL}/admin/reviews</a></p>"""
    text = f"Estimado(a) {admin_name},\n\nTiene documentos pendientes de revisión hace {days} o más días.\n\nRevise en: {APP_URL}/admin/reviews\n\nEste es un mensaje automático del Sistema SGAC.\n---\nDesarrollado por Mejoramiento Continuo\nCorporación Administrativa del Poder Judicial"
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = _FROM_HEADER
    msg["To"] = to_email
    msg["Bcc"] = SMTP_BCC
    msg.attach(MIMEText(text, "plain", "utf-8"))
    msg.attach(MIMEText(_html(body), "html", "utf-8"))
    return _send([to_email, SMTP_BCC], msg)


def send_password_change_email(to_email, user_name, new_password):
    if not SMTP_HOST or not SMTP_USER:
        print(f"[EMAIL] SMTP no configurado: cambio contrasena para {to_email}")
        return False
    subject = "Actualización de contraseña - Sistema SGAC"
    body = f"""<p style="font-size:14px;font-weight:bold;margin:0 0 6px 0;">Estimado(a), {user_name}</p>
<p style="margin:0 0 6px 0;font-size:12px;">Le informamos que su contraseña de acceso al Sistema SGAC ha sido actualizada por un administrador.</p>
<table width="100%" cellpadding="0" cellspacing="0" border="1" style="border-collapse:collapse;border-color:#112d86;margin:8px 0;">
  <tr><td colspan="2" style="padding:5px 10px;background-color:#112d86;"><span style="color:white;font-size:12px;font-weight:bold;">Sus nuevas credenciales de acceso:</span></td></tr>
  <tr><td style="padding:5px 10px;font-weight:bold;color:#112d86;font-size:12px;width:40%;background-color:white;">Correo electrónico:</td><td style="padding:5px 10px;font-size:12px;background-color:white;">{to_email}</td></tr>
  <tr><td style="padding:5px 10px;font-weight:bold;color:#112d86;font-size:12px;background-color:#f9f9f9;">Contraseña:</td><td style="padding:5px 10px;font-family:monospace;font-size:14px;color:#8b2332;background-color:#f9f9f9;">{new_password}</td></tr>
</table>
<p style="margin:6px 0 0 0;font-size:12px;">Acceda al sistema en: <a href="{APP_URL}/login" style="color:#112d86;font-weight:bold;">{APP_URL}/login</a></p>"""
    text = f"Estimado(a) {user_name},\n\nSu contraseña ha sido actualizada.\n\n- Correo: {to_email}\n- Nueva contraseña: {new_password}\n\nAcceda en: {APP_URL}/login\n\nEste es un mensaje automático del Sistema SGAC.\n---\nDesarrollado por Mejoramiento Continuo\nCorporación Administrativa del Poder Judicial"
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = _FROM_HEADER
    msg["To"] = to_email
    msg["Bcc"] = SMTP_BCC
    msg.attach(MIMEText(text, "plain", "utf-8"))
    msg.attach(MIMEText(_html(body), "html", "utf-8"))
    return _send([to_email, SMTP_BCC], msg)
