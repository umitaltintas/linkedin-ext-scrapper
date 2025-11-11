## Extension Key

- `extension-key.pem`: RSA private key used to keep the Chrome extension ID stable. **Keep this file private** and rotate if exposed.
- `extension-key.pub.base64`: Base64-encoded DER public key. Its contents go into `manifest.json` under the `"key"` field.

If you ever need to regenerate the ID:

```bash
openssl genrsa -out extension/extension-key.pem 2048
openssl rsa -in extension/extension-key.pem -pubout -outform DER | openssl base64 -A > extension/extension-key.pub.base64
```

After updating `extension-key.pub.base64`, copy the single-line value into `manifest.json` and rebuild/reload the extension. The extension ID derived from this key (currently `hnfkpaaphfmbhcaedaejaanfjcghppan`) must match the value expected by the web client.
