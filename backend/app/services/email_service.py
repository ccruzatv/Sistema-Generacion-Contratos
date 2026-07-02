import smtplib
import os
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

# Email configuration via environment variables
SMTP_HOST = os.getenv("SMTP_HOST", "")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
SMTP_FROM = os.getenv("SMTP_FROM", "noreply@pjud.cl")
APP_URL = os.getenv("APP_URL", "http://localhost:5173")


def send_invitation_email(
    to_email: str,
    user_name: str,
    temp_password: str,
    role: str,
) -> bool:
    """Send an invitation email with temporary credentials.

    Returns True if email was sent successfully, False otherwise.
    If SMTP is not configured, logs the invitation details and returns False.
    """
    if not SMTP_HOST or not SMTP_USER:
        print(f"[EMAIL] SMTP no configurado. Invitación para {to_email}:")
        print(f"  Nombre: {user_name}")
        print(f"  Contraseña temporal: {temp_password}")
        print(f"  Rol: {role}")
        print(f"  URL: {APP_URL}/login")
        return False

    subject = "Invitación al Sistema de Generación de Contratos - Poder Judicial"

    html_body = f"""
    <html>
    <body style="font-family: 'Century Gothic', Arial, sans-serif; color: #1a2d56; max-width: 600px; margin: 0 auto;">
        <div style="background-color: #1a2d56; padding: 20px; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 18px;">
                Sistemas de Generación de Contratos
            </h1>
            <p style="color: #a8b8d8; margin: 5px 0 0; font-size: 12px;">
                Subdepartamento de Mejoramiento Continuo
            </p>
        </div>
        <div style="border: 3px solid #c8a84e; border-top: none;"></div>
        <div style="padding: 30px; background-color: #f0f3f8;">
            <h2 style="color: #1a2d56; margin-top: 0;">
                Bienvenido(a), {user_name}
            </h2>
            <p>
                Ha sido invitado(a) al Sistema de Generación de Contratos del
                Poder Judicial de Chile.
            </p>
            <div style="background-color: white; border: 1px solid #1a2d56; border-radius: 8px; padding: 20px; margin: 20px 0;">
                <h3 style="color: #1a2d56; margin-top: 0;">Sus credenciales de acceso:</h3>
                <table style="width: 100%; border-collapse: collapse;">
                    <tr>
                        <td style="padding: 8px 0; font-weight: bold; color: #1a2d56;">Correo electrónico:</td>
                        <td style="padding: 8px 0;">{to_email}</td>
                    </tr>
                    <tr>
                        <td style="padding: 8px 0; font-weight: bold; color: #1a2d56;">Contraseña temporal:</td>
                        <td style="padding: 8px 0; font-family: monospace; font-size: 16px; color: #8b2332;">
                            {temp_password}
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 8px 0; font-weight: bold; color: #1a2d56;">Rol asignado:</td>
                        <td style="padding: 8px 0; text-transform: capitalize;">{role}</td>
                    </tr>
                </table>
            </div>
            <p>
                Acceda al sistema en:
                <a href="{APP_URL}/login" style="color: #1a2d56; font-weight: bold;">
                    {APP_URL}/login
                </a>
            </p>
            <p style="color: #8a7232; font-size: 13px; background-color: #c8a84e20; padding: 10px; border-radius: 6px;">
                <strong>Importante:</strong> Se recomienda cambiar su contraseña
                temporal después del primer inicio de sesión.
            </p>
        </div>
        <div style="background-color: #1a2d56; padding: 15px; text-align: center; border-top: 3px solid #c8a84e;">
            <p style="color: #a8b8d8; font-size: 11px; margin: 0;">
                Desarrollado por Mejoramiento Continuo &mdash; ccruzatv@pjud.cl
            </p>
            <p style="color: #6b7fa8; font-size: 10px; margin: 5px 0 0;">
                Poder Judicial &ndash; Corporación Administrativa del Poder Judicial
            </p>
        </div>
    </body>
    </html>
    """

    text_body = f"""
Bienvenido(a), {user_name}

Ha sido invitado(a) al Sistema de Generación de Contratos del Poder Judicial de Chile.

Sus credenciales de acceso:
- Correo electrónico: {to_email}
- Contraseña temporal: {temp_password}
- Rol asignado: {role}

Acceda al sistema en: {APP_URL}/login

Importante: Se recomienda cambiar su contraseña temporal después del primer inicio de sesión.

---
Desarrollado por Mejoramiento Continuo - ccruzatv@pjud.cl
Poder Judicial - Corporación Administrativa del Poder Judicial
    """

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = SMTP_FROM
    msg["To"] = to_email

    msg.attach(MIMEText(text_body, "plain", "utf-8"))
    msg.attach(MIMEText(html_body, "html", "utf-8"))

    return _send_email(to_email, msg)


def send_draft_notification_email(
    to_email: str,
    admin_name: str,
    submitter_name: str,
    document_name: str,
) -> bool:
    """Send email notification to admin when operativo submits a draft."""
    if not SMTP_HOST or not SMTP_USER:
        print(f"[EMAIL] SMTP no configurado. Notificación de borrador para {to_email}:")
        print(f"  Administrador: {admin_name}")
        print(f"  Enviado por: {submitter_name}")
        print(f"  Documento: {document_name}")
        return False

    subject = f"Nuevo borrador para revisión - {document_name}"

    html_body = f"""
    <html>
    <body style="font-family: 'Century Gothic', Arial, sans-serif; color: #1a2d56; max-width: 600px; margin: 0 auto;">
        <div style="background-color: #1a2d56; padding: 20px; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 18px;">
                Sistemas de Generación de Contratos
            </h1>
            <p style="color: #a8b8d8; margin: 5px 0 0; font-size: 12px;">
                Notificación de borrador
            </p>
        </div>
        <div style="border: 3px solid #c8a84e; border-top: none;"></div>
        <div style="padding: 30px; background-color: #f0f3f8;">
            <h2 style="color: #1a2d56; margin-top: 0;">
                Estimado(a) {admin_name},
            </h2>
            <p>
                El usuario <strong>{submitter_name}</strong> ha enviado un borrador
                para su revisión.
            </p>
            <div style="background-color: white; border: 1px solid #1a2d56; border-radius: 8px; padding: 20px; margin: 20px 0;">
                <h3 style="color: #1a2d56; margin-top: 0;">Detalle del documento:</h3>
                <p><strong>Nombre:</strong> {document_name}</p>
                <p><strong>Enviado por:</strong> {submitter_name}</p>
            </div>
            <p>
                Revise el documento en:
                <a href="{APP_URL}/admin/reviews" style="color: #1a2d56; font-weight: bold;">
                    {APP_URL}/admin/reviews
                </a>
            </p>
        </div>
        <div style="background-color: #1a2d56; padding: 15px; text-align: center; border-top: 3px solid #c8a84e;">
            <p style="color: #a8b8d8; font-size: 11px; margin: 0;">
                Desarrollado por Mejoramiento Continuo &mdash; ccruzatv@pjud.cl
            </p>
            <p style="color: #6b7fa8; font-size: 10px; margin: 5px 0 0;">
                Poder Judicial &ndash; Corporación Administrativa del Poder Judicial
            </p>
        </div>
    </body>
    </html>
    """

    text_body = f"""
Estimado(a) {admin_name},

El usuario {submitter_name} ha enviado un borrador para su revisión.

Documento: {document_name}
Enviado por: {submitter_name}

Revise el documento en: {APP_URL}/admin/reviews

---
Desarrollado por Mejoramiento Continuo - ccruzatv@pjud.cl
Poder Judicial - Corporación Administrativa del Poder Judicial
    """

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = SMTP_FROM
    msg["To"] = to_email

    msg.attach(MIMEText(text_body, "plain", "utf-8"))
    msg.attach(MIMEText(html_body, "html", "utf-8"))

    return _send_email(to_email, msg)


def _send_email(to_email: str, msg: MIMEMultipart) -> bool:
    """Send an email message via SMTP."""
    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
            server.ehlo()
            if SMTP_PORT == 587:
                server.starttls()
                server.ehlo()
            server.login(SMTP_USER, SMTP_PASSWORD)
            server.sendmail(SMTP_FROM, to_email, msg.as_string())
        return True
    except Exception as e:
        print(f"[EMAIL] Error al enviar correo a {to_email}: {e}")
        return False
