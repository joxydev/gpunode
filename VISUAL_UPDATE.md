# Core animation and managed requests

> Историческая заметка. Визуал ядра позже заменён неподвижным фоном с локальным мерцанием (`WEBVIEW_PULSE_UPDATE.md`), а верхняя иконка профиля удалена. Текущее состояние описывает `README.md`.

- Welcome core pulses between 94% and 103% scale every 3.2 seconds with a cyan/violet halo. Uses transform/opacity; respects reduced-motion preferences.
- Shared workspace header displays a compact account icon with an accessible name.
- Request form and request history no longer display profiles. Client submits node and idempotency key only.
- Server ignores client-provided profiles; new requests are recorded as MANAGED (service-managed). This is a workflow marker, not a command or a measurement of GPU utilization.
- Additive constraint migration retains existing ECO/BALANCED/PERFORMANCE records.
- Agreement and PDF are preserved; existing acceptance remains valid.
