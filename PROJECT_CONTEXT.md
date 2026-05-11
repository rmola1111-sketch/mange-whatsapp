\# System Overview



\## Project Type

WhatsApp SaaS Platform



\## Main Stack

\- Node.js

\- Express

\- Socket.IO

\- SQLite

\- whatsapp-web.js



\## Current Architecture

The system manages multiple WhatsApp clients and provides automated messaging services for businesses.



\## Main Modules

\- controllers

\- services

\- middleware

\- whatsapp

\- db

\- routes

\- utils



\## System Goals

\- High scalability

\- Stable WhatsApp sessions

\- Queue stability

\- SaaS architecture

\- AI integration

\- Multi business support



\## Coding Rules

\- Use async/await only

\- Always add try/catch

\- Avoid duplicate logic

\- Keep services modular

\- Never block the event loop

\- Add logs for critical operations

\- Validate all inputs



\## Current Known Problems

\- Queue freezes sometimes

\- Session restore instability

\- Memory usage spikes

\- Retry logic needs improvement



\## Important Notes

\- WhatsApp sessions are critical

\- Stability is more important than speed

\- System should support multiple businesses

