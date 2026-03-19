#!/bin/bash
# Deploy plugin files to Google Drive vault (sync cloud)
# Uso: bash cloudDeploy.sh

# MSYS_NO_PATHCONV=1 impedisce a Git Bash di convertire i path C:/ in /c/
# ed evita che mkdir crei una cartella "C:" relativa
export MSYS_NO_PATHCONV=1

VAULT_PLUGIN="C:/Users/gabri/Il mio Drive (gabrielecusato@gmail.com)/Projects/handwriting-to-markdown"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

mkdir -p "$VAULT_PLUGIN"
cp "$SCRIPT_DIR/main.js" "$SCRIPT_DIR/manifest.json" "$SCRIPT_DIR/styles.css" "$VAULT_PLUGIN/"

echo "Deployed to $VAULT_PLUGIN"
echo "  main.js     $(wc -c < "$VAULT_PLUGIN/main.js") bytes"
echo "  manifest.json"
echo "  styles.css"
echo ""
echo "In Obsidian: Ctrl+P -> 'Reload app without saving'"
