# optimization potential
- Alle freigeben/ übernehmen buttons > Bulk operation
    - currently consecutive calls, should be one call that is processed in bulk by the backend
    - contract spec drafted for backend team: see [docs/backend-request-bulk-tasks.md](backend-request-bulk-tasks.md), pending backend implementation

- user detail sidebar loader makes consecutive resource calls to load the info > should be one bulk call to the backend  