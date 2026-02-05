---
name: podcast
description: Generate a podcast episode from a topic or content using Kokoro TTS
---

# Podcast Generation Skill

When the user asks to create a podcast episode, follow this process:

## Process

1. **Understand the request**: What topic, style, length, and audience?
2. **Research** (if needed): Use deep-research skill for complex topics
3. **Script**: Write a podcast script in conversational style
4. **Generate audio**: Use the tts_generate tool with Kokoro TTS
5. **Save**: Output to `data/podcasts/YYYY-MM-DD-<title-slug>.wav`
6. **Deliver**: Send the audio file to the user via the originating channel

## Script Format

Write the script as a single-voice narration:

```
[INTRO]
Welcome to Vaman Insights. Today we're diving into <topic>...

[SECTION 1: <title>]
<content>

[SECTION 2: <title>]
<content>

[CONCLUSION]
<wrap-up and key takeaways>

[OUTRO]
That's all for today. Thanks for listening.
```

## Guidelines

- Keep episodes 3-10 minutes (600-2000 words)
- Use conversational, engaging language
- Include transitions between sections
- Avoid overly technical jargon unless the audience expects it
- Break complex topics into digestible segments
- Current voice: Kokoro TTS (single speaker)
- Future: Gemini podcast model for multi-speaker episodes
