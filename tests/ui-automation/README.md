# UI activity integration tests

Run from the Studio repository on Windows with dependencies installed:

```
node tests/ui-automation/launch.cjs
node tests/ui-automation/launch.cjs --native
node tests/ui-automation/launch.cjs --uia-selection
```

The browser suite derives its inventory from the four activity catalog categories
and invokes the public `executeActivity` entry point. It launches installed Chrome
against a localhost fixture, checks actual DOM values/events/files, covers all 48
activities, and includes failure cases and ten repeated click/type/read cycles.
It does not access personal browser profiles or external websites.

The native suite compiles an isolated WinForms fixture with the installed .NET
Framework compiler. It verifies control values and event counters from the fixture's
state file, not just activity success messages. It covers mouse, keyboard, edit,
checkbox, selection, extraction, waits/assertions, screenshot and window behavior.
UIA and recorder-compatible MSAA selectors are exercised. Capability probes record
native operations which the current executor explicitly does not implement.

The expanded native suite includes 40 scenarios: legacy MSAA mouse coordinates on
a scaled display, UIA mouse selectors, focused Enter/Ctrl+A/Backspace and named keys,
literal Unicode option text, selection-change notifications, and invalid/ambiguous
selections which must not change the current value. Keyboard events are verified by
numeric virtual-key codes because .NET enum aliases can stringify differently.

`--uia-selection` uses a separate WPF fixture and runs nine selection cases through
real UIAutomation SelectionItem/ExpandCollapse patterns. The standard WinForms
selection cases use the native combo-box/MSAA path. Native controls accept Text or
zero-based Index; the browser-only HTML Value attribute is rejected explicitly.

Each launcher prints its temporary results directory and exits nonzero on failures.
The JSON files distinguish scenario failures from native capability gaps. A passing
browser suite does not imply that all HTML/browser operations work in native apps.
The native suite controls the foreground test window; avoid other UI input while it runs.

For desktop environments which require launching a visible executable through their
app launcher, prepare `<runner>/resources/app` with `prepare.cjs`, copy the installed
Electron distribution into `<runner>`, then launch `<runner>/electron.exe`.

Robot's TypeScript check uses `noEmit` so building Robot cannot leave stale compiled
JavaScript beside the shared automation sources and shadow subsequent Studio builds.
