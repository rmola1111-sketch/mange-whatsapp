\# Claude Development Rules



\## Main Goal

Maintain a scalable and stable WhatsApp SaaS platform.



\---



\## Critical Rules



\### Stability First

Never sacrifice system stability for optimization.



\### Do Not Break Existing Logic

Before changing logic:

\- analyze dependencies

\- preserve existing behavior

\- avoid unnecessary rewrites



\### Safe Refactoring Only

\- Refactor incrementally

\- Avoid giant rewrites

\- Keep backward compatibility



\### Architecture Rules

\- Keep services modular

\- Avoid giant files

\- Separate business logic from transport layers

\- Queue logic must stay isolated

\- WhatsApp session logic is critical



\### Performance Rules

\- Never block event loop

\- Avoid memory leaks

\- Avoid duplicate processing

\- Minimize DB queries when possible



\### Error Handling

\- Always use try/catch

\- Add meaningful logs

\- Prevent crashes

\- Validate all inputs



\### Scaling Goals

The system should eventually support:

\- multiple businesses

\- many WhatsApp clients

\- high message volume

\- AI integrations



\### Coding Style

\- async/await only

\- clear naming

\- defensive programming

\- modular architecture



\### Before Any Refactor

Always explain:

1\. the problem

2\. the risks

3\. the proposed solution

4\. expected improvements

