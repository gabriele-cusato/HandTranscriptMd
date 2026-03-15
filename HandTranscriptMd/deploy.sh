#!/bin/bash
# Deploy plugin files to Obsidian vault
# Uso: bash deploy.sh

VAULT_PLUGIN="C:/Projects/CLIENTI/IOTTI/IOTTI_APP/_docs/handwriting-to-markdown/.obsidian/plugins/handwriting-to-markdown"
SRC_DIR="$(dirname "$0")"

mkdir -p "$VAULT_PLUGIN"
cp "$SRC_DIR/main.js" "$SRC_DIR/manifest.json" "$SRC_DIR/styles.css" "$VAULT_PLUGIN/"

echo "Deployed to $VAULT_PLUGIN"
echo "  main.js     $(wc -c < "$VAULT_PLUGIN/main.js") bytes"
echo "  manifest.json"
echo "  styles.css"
echo ""
echo "In Obsidian: Ctrl+P -> 'Reload app without saving'"
