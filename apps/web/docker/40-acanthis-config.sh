#!/bin/sh
set -eu

CONFIG_PATH="/usr/share/nginx/html/config.js"

if [ -n "${DEFAULT_API_BASE_URL:-}" ]; then
	ESCAPED_URL=$(printf '%s' "${DEFAULT_API_BASE_URL}" | tr -d '\r\n' | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/</\\u003c/g' -e 's/>/\\u003e/g')
	printf 'window.__ACANTHIS_CONFIG__ = { defaultApiBaseUrl: "%s" };\n' "${ESCAPED_URL}" > "${CONFIG_PATH}"
fi
