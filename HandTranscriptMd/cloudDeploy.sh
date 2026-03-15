#!/bin/bash
# Deploy plugin files to Google Drive vault (sync cloud)
# Uso: bash cloudDeploy.sh

VAULT_PLUGIN="C:/Users/gabri/Il mio Drive (gabrielecusato@gmail.com)/Projects/handwriting-to-markdown"
SRC_DIR="$(dirname "$0")"

mkdir -p "$VAULT_PLUGIN"
cp "$SRC_DIR/main.js" "$SRC_DIR/manifest.json" "$SRC_DIR/styles.css" "$VAULT_PLUGIN/"

echo "Deployed to $VAULT_PLUGIN"
echo "  main.js     $(wc -c < "$VAULT_PLUGIN/main.js") bytes"
echo "  manifest.json"
echo "  styles.css"
echo ""
echo "In Obsidian: Ctrl+P -> 'Reload app without saving'"
