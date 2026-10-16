# SalesFlow 2.0

Static responsive dashboard backed by the existing Supabase project. Deploy the `salesflow` directory with framework `Other` and no build command. Keep other projects in this repository unchanged.

## Access

Login uses Supabase email/password. Initial password setup uses a separate server-side Edge Function `salesflow-activate` and a private, single-use, expiring activation code issued by the project owner. Codes and service credentials are never included in the frontend or in Git. The database, not the UI, decides which confirmed accounts can read or modify financial data.

The two permitted accounts share receipts and exchange settings. The frontend refreshes visible pages every ten seconds, on foreground, and on explicit refresh. Writes are online only. Version checks prevent silent overwrites between devices. Login sessions can persist in the browser; logging out clears them.

## Calculations

Money accumulates in integer cents. Conversions round per receipt. Unconfigured currency rates produce an incomplete-conversion notice rather than silently lowering totals. Rates are manual reporting estimates and changing them revalues historical receipts. Dates use Europe/Dublin and inclusive calendar-day ranges. Growth compares the equally long immediately preceding range and is undefined when its base is zero.

## Import and export

JSON import is additive and retains existing records. Duplicate IDs are ignored. Rates are not overwritten by import. Legacy IDs are normalized deterministically. A backup can contain sensitive financial records: store it privately. Frontend contains no demonstration sales.

## Validation

27 automated date/money checks and 26 Chromium offline UI checks passed for this revision. UI checks use mocked API, storage, and a digest adapter because network navigation is disabled in the build environment. These are not live login or production end-to-end tests. Backend permissions and triggers were separately inspected through the project database. User activation, real sessions, and the final deployment still require live validation.
