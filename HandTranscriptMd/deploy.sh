#!/bin/bash
# Deploy plugin files to Obsidian vault
# Uso: bash deploy.sh

export MSYS_NO_PATHCONV=1

VAULT_PLUGIN="C:/Projects/CLIENTI/IOTTI/IOTTI_APP/_docs/handwriting-to-markdown/.obsidian/plugins/handwriting-to-markdown"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

mkdir -p "$VAULT_PLUGIN"
cp "$SCRIPT_DIR/main.js" "$SCRIPT_DIR/manifest.json" "$SCRIPT_DIR/styles.css" "$VAULT_PLUGIN/"

echo "Deployed to $VAULT_PLUGIN"
echo "  main.js     $(wc -c < "$VAULT_PLUGIN/main.js") bytes"
echo "  manifest.json"
echo "  styles.css"
echo ""
echo "In Obsidian: Ctrl+P -> 'Reload app without saving'"
