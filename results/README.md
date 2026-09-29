# Test Result Storage

This directory contains generated evidence from local, live-device, and long-running tests. JSON result files are intentionally ignored by source control.

Each long-run report should include:

- test name and implementation version or source snapshot;
- device ID and model, without USB serial or credentials;
- start and finish timestamps;
- requested duration and actual duration;
- cycle counts and pass/fail counts;
- categorized errors and interruption states;
- whether any account-changing operation was committed;
- bounded diagnostic references, not full page or account content.

Use a companion status file while a detached test is active. It should contain the process ID, state, last heartbeat, current cycle, report path, and a safe stop instruction. Replace or remove the status file when the run finishes.

Never store relay tokens, SSH credentials, private keys, certificate passwords, cookies, X passwords, authorization headers, or captured private content here.

