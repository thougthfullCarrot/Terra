/**
 * An error message safe to log and publish: anything shaped like a key or
 * token parameter, and the values of the API key variables themselves, are
 * replaced, and the message is cut short.
 */
export function redact(message: string, secrets: (string | undefined)[] = []): string {
  let text = message.replace(/((?:api_?)?key|registrationkey|token|access_token)=[^&\s"']+/gi, '$1=[redacted]');
  for (const secret of secrets) if (secret && secret.length >= 6) text = text.split(secret).join('[redacted]');
  return text.replace(/\s+/g, ' ').trim().slice(0, 240);
}
