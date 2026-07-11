# Visual Companion Automation Bridge

The Visual Intelligence Companion can suggest approved actions, but it cannot execute them directly.

Required chain:
1. visual response
2. deterministic response policy
3. suggested action allowlist
4. user confirmation or explicit recipe authorization
5. automation policy authorization
6. action adapter execution
7. receipt

Forbidden:
- action execution from model text
- arbitrary commands
- unrestricted URLs
- raw media in payloads
- recursive observation requests
- hidden model calls from recipe matching

Suggested actions are secondary UI content and must not displace Camera -> Observe now -> Contextual response.
