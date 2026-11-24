---
trigger: always_on
glob: "tests/**/*.php,app/**/*.php"
description: Testing constraints for controllers and unit tests
---

- Do not write tests for controllers.
- Keep unit tests minimal and treat the system under test as a black box. Test what matters, and do not aim for 100% code coverage.
- Prune tests that are unlikely to have real-world impact or catch bugs. We want to save future LLM tokens.
