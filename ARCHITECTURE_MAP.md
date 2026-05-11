\# System Architecture Map



\## Entry Point

server.js



The server initializes:

\- Express server

\- Socket.IO

\- WhatsApp services

\- Database connection

\- Routes

\- Middleware



\---



\# Main Flow



Client Message

↓

WhatsApp Client

↓

Message Handler

↓

Queue System

↓

Business Logic

↓

Database

↓

Response Generator

↓

WhatsApp Send Message



\---



\# Main Modules



\## whatsapp/

Responsible for:

\- WhatsApp sessions

\- Client initialization

\- QR management

\- Event handling

\- Message receiving

\- Message sending



Critical:

This module must remain stable.



\---



\## services/

Contains:

\- business logic

\- queue handling

\- automation logic

\- message processing



Rules:

Keep services modular.



\---



\## controllers/

Responsible for:

\- handling API requests

\- validating requests

\- calling services



Rules:

No heavy business logic here.



\---



\## middleware/

Responsible for:

\- authentication

\- validation

\- security

\- request preprocessing



\---



\## db/

Responsible for:

\- SQLite connection

\- queries

\- persistence



Important:

Avoid excessive DB operations.



\---



\## routes/

Defines API endpoints.



Rules:

Routes should remain lightweight.



\---



\## utils/

Shared helper functions.



Rules:

Avoid putting business logic here.



\---



\# Known System Risks



\## Queue Risks

\- possible freezes

\- duplicate processing

\- retry instability



\## WhatsApp Risks

\- disconnected sessions

\- session corruption

\- QR expiration



\## Performance Risks

\- memory leaks

\- event loop blocking

\- excessive logging



\---



\# Scaling Goals



The architecture should eventually support:

\- multiple businesses

\- many concurrent clients

\- AI integrations

\- horizontal scaling

\- monitoring systems

\- analytics

