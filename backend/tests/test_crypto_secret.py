from app.crypto_secret import decrypt_secret, encrypt_secret


def test_round_trip():
    token = encrypt_secret("xai-test-not-real")
    assert not token.startswith("xai-")
    assert decrypt_secret(token) == "xai-test-not-real"


def test_wrong_unlock_fails(monkeypatch):
    token = encrypt_secret("xai-test-not-real")
    monkeypatch.setenv("DOTSLASH_UNLOCK", "wrong-passphrase")
    try:
        decrypt_secret(token)
        assert False, "expected decrypt to fail"
    except RuntimeError as exc:
        assert "DOTSLASH_UNLOCK" in str(exc)
