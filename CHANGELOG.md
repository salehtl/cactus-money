# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [2.1.1] - 2026-03-10

### Added
- Uncategorized filter toggle in PDF import review modal
- Portal-rendered category dropdown in review table (escapes overflow clipping)
- Model name shown in modal title during PDF import

### Fixed
- Partial rate-limit failure silently skipping batches in PDF import
- Streaming UX restored: transactions appear one-by-one during import instead of in bulk
- Select-all checkbox now scopes to active filter (file or uncategorized)
- Portal dropdown positioning: clamps to viewport edges and flips upward near bottom

## [2.1.0] - 2026-03-09

### Added
- Changelog with "What's New" viewer in Settings
- Multi-provider PDF import (Anthropic, OpenAI, Gemini, custom)

## [2.0.0] - 2026-02-15

### Added
- Zakat calculator with madhab-aware engine and stock support
- Two-column zakat layout with live breakdown and mobile sticky bar
- Privacy notice on PDF import modal
- Recurring transactions with frequency display
- Overview page with multi-month chart and pivot grid
