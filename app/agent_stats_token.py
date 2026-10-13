"""Short-lived signed identity for SOFA's personal Genesys report.

The SOFA login issues the token; both SOFA and SD-API verify it. It is kept in an
HttpOnly cookie and forwarded by SOFA as a Bearer token. No browser-supplied user ID
or legacy unsigned session data is trusted by the SD-API endpoint.
"""
import base64
import binascii
import hashlib
import hmac
import json
import os
import time

AUDIENCE = 'sofa-agent-stats-v1'
MAX_AGE = 8 * 3600


def _secret():
    encoded = os.getenv('SOFA_AGENT_STATS_SECRET_B64', '').strip()
    if not encoded:
        raise RuntimeError('SOFA_AGENT_STATS_SECRET_B64 fehlt.')
    try:
        value = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise RuntimeError('SOFA_AGENT_STATS_SECRET_B64 ist ungültig.') from exc
    if len(value) < 32:
        raise RuntimeError('SOFA_AGENT_STATS_SECRET_B64 muss mindestens 32 Bytes enthalten.')
    return value


def is_configured():
    try:
        _secret()
    except RuntimeError:
        return False
    return True


def _encode(data):
    return base64.urlsafe_b64encode(data).decode('ascii').rstrip('=')


def _decode(value):
    return base64.urlsafe_b64decode(value + '=' * (-len(value) % 4))


def issue(user_id, now=None):
    issued = int(time.time() if now is None else now)
    if not isinstance(user_id, int) or user_id <= 0:
        raise ValueError('Ungültige Benutzer-ID.')
    payload = _encode(json.dumps({'aud': AUDIENCE, 'sub': user_id, 'iat': issued,
                                  'exp': issued + MAX_AGE}, separators=(',', ':'), sort_keys=True).encode())
    signature = _encode(hmac.new(_secret(), payload.encode(), hashlib.sha256).digest())
    return payload + '.' + signature


def verify(token, now=None):
    try:
        payload, signature = token.split('.')
        expected = hmac.new(_secret(), payload.encode(), hashlib.sha256).digest()
        if not hmac.compare_digest(_decode(signature), expected):
            raise ValueError('Signatur ungültig.')
        claims = json.loads(_decode(payload))
        current = int(time.time() if now is None else now)
        uid, issued, expiry = claims['sub'], claims['iat'], claims['exp']
        if (claims['aud'] != AUDIENCE or type(uid) is not int or uid <= 0
                or type(issued) is not int or type(expiry) is not int
                or issued > current + 30 or expiry <= current or expiry - issued != MAX_AGE):
            raise ValueError('Token ungültig oder abgelaufen.')
        return uid
    except RuntimeError:
        raise
    except (ValueError, KeyError, TypeError, UnicodeError, binascii.Error) as exc:
        raise ValueError('Token ungültig oder abgelaufen.') from exc
