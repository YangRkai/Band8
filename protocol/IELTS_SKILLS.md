# IELTS Skill Taxonomy 0.1

Each skill is observable, trainable, and supportable by cited evidence. IDs are stable lowercase dotted identifiers.

| Skill ID | Parent | Description | Observable evidence |
| --- | --- | --- | --- |
| `listening.detail` | `listening` | Retrieve explicit detail from audio | submitted answer tied to replay facts |
| `listening.paraphrase` | `listening` | Map spoken paraphrase to answer language | selection or text response with timing |
| `listening.sequence` | `listening` | Track ordered information | ordered answer and correction evidence |
| `reading.tfng.semantic-relation` | `reading.tfng` | Distinguish contradiction from absent support | classification plus selected passage span |
| `reading.main-idea` | `reading` | Identify controlling claim | answer and evidence span |
| `reading.reference` | `reading` | Resolve pronoun or phrase reference | answer with local textual evidence |
| `reading.paraphrase` | `reading` | Match claim to paraphrased evidence | match result and explanation |
| `writing.task-response` | `writing` | Address all task requirements | essay artifact scored by rubric dimension |
| `writing.coherence` | `writing` | Organize progression and cohesion | versioned draft and revision evidence |
| `writing.lexical-resource` | `writing` | Use precise, appropriate vocabulary | artifact excerpts and rubric observation |
| `writing.grammar-range-accuracy` | `writing` | Produce varied accurate structures | artifact excerpts and correction history |
| `speaking.fluency-coherence` | `speaking` | Sustain organized speech | audio artifact, duration, pauses, rubric observation |
| `speaking.lexical-resource` | `speaking` | Use flexible topic-appropriate vocabulary | audio/transcript evidence |
| `speaking.grammar-range-accuracy` | `speaking` | Use varied accurate spoken grammar | audio/transcript evidence |
| `speaking.pronunciation` | `speaking` | Remain intelligible with effective prosody | audio evidence and rubric observation |

Parent nodes organize references but do not receive fabricated numeric scores. New micro-skills require a protocol version change when they alter package interpretation.
