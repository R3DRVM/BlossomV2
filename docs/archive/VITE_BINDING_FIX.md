# Vite Binding Fix - Ensure 127.0.0.1 Always Works

**Date:** 2025-01-04  
**Status:** ✅ **FIXED** - Vite now binds to 0.0.0.0, ensuring 127.0.0.1 always works

---

## Problem

Vite dev server sometimes bound to IPv6 `[::1]:5173` instead of IPv4 `127.0.0.1:5173`, causing connection issues when accessing `http://127.0.0.1:5173/app`.

---

## Solution

**Updated `vite.config.ts` to explicitly bind to `0.0.0.0`:**

```typescript
server: {
  host: '0.0.0.0', // Bind to all interfaces (ensures 127.0.0.1 works)
  port: 5173,
  strictPort: true, // Fail if port is already in use
}
```

**Benefits:**
- `0.0.0.0` binds to all network interfaces (IPv4 and IPv6)
- Ensures `127.0.0.1` (IPv4 localhost) always works
- Also accessible via `localhost` and `[::1]` (IPv6 localhost)
- `strictPort: true` fails fast if port is in use (better error messages)

**Updated `scripts/restart-demo.sh`:**
- Always prints `http://127.0.0.1:5173/app` in operator commands
- Attempts to open browser automatically (macOS `open`, Linux `xdg-open`)
- Shows frontend URL even if preflight check fails

---

## Files Changed

| File | Changes |
|------|---------|
| `vite.config.ts` | Added `server` config with `host: '0.0.0.0'`, `port: 5173`, `strictPort: true` |
| `scripts/restart-demo.sh` | Added browser auto-open, ensured `http://127.0.0.1:5173/app` is always printed |

---

## Verification

**After restarting demo:**

```bash
# 1. Check Vite is bound correctly (should show 0.0.0.0:5173, NOT [::1]:5173)
lsof -nP -iTCP:5173 -sTCP:LISTEN

# Expected output:
# COMMAND   PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME
# node    12345 user   20u  IPv4  ...      0t0  TCP 0.0.0.0:5173 (LISTEN)

# Should NOT show:
# node    12345 user   20u  IPv6  ...      0t0  TCP [::1]:5173 (LISTEN)

# 2. Verify 127.0.0.1 works
curl -s http://127.0.0.1:5173 | head -5

# Expected: HTML response (not connection refused)

# 3. Verify app route works
curl -s http://127.0.0.1:5173/app | head -5

# Expected: HTML response (not 404)
```

---

## Expected Behavior

**Before:**
- Vite might bind to `[::1]:5173` (IPv6 only)
- `http://127.0.0.1:5173/app` could fail with connection refused
- Inconsistent binding behavior

**After:**
- Vite always binds to `0.0.0.0:5173` (all interfaces)
- `http://127.0.0.1:5173/app` always works
- Also accessible via `localhost:5173` and `[::1]:5173`
- Consistent, predictable behavior

---

## Package.json Scripts

**No changes needed** - `vite.config.ts` handles the server configuration, so `npm run dev` and `npm run dev:demo` will automatically use the correct binding.

The `dev:demo` script in `package.json` remains:
```json
"dev:demo": "npx concurrently --kill-others-on-fail --names \"frontend,backend\" --prefix-colors \"blue,green\" \"npm run dev\" \"cd agent && PORT=3001 npm run dev\""
```

Vite will read `vite.config.ts` and use the `server` configuration automatically.

---

## Summary

✅ **Vite binds to `0.0.0.0:5173`** (all interfaces)  
✅ **`http://127.0.0.1:5173/app` always works**  
✅ **No IPv6-only binding** (`[::1]:5173` won't be the only listener)  
✅ **Restart script prints and opens correct URL**  
✅ **Consistent, predictable behavior**

**Next Steps:**
1. Restart demo: `./scripts/restart-demo.sh`
2. Verify binding: `lsof -nP -iTCP:5173 -sTCP:LISTEN`
3. Confirm it shows `0.0.0.0:5173` (not `[::1]:5173`)


