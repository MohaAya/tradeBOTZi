# NVIDIA AI Factory Operations Agent evaluation

Source reviewed: `NVIDIA/AI-Factory-Operations-Agent`.

The NVIDIA project is an experimental operations-agent blueprint for governed infrastructure diagnostics and operations. Its useful ideas for tradeBOTZi are operational rather than trading-specific.

## Concepts adapted into tradeBOTZi

tradeBOTZi independently implements the following operations patterns:

- long-running server-side jobs instead of browser-bound tasks
- explicit run/cycle identifiers
- persisted run metadata and history
- evidence-oriented audit events
- separation between an agent's preferred provider and the provider that actually answered
- bounded server-side credentials and tools; browser clients do not receive them
- concrete action results rather than decorative "agent working" states
- health/status endpoints for operational loops
- explicit distinction between analysis and mutation/execution
- deterministic risk/execution authority outside the LLM

The PAPER Portfolio Supervisor now records each cycle with:

- cycle ID
- reason
- start and finish timestamps
- status
- accounts checked
- concrete simulated actions
- errors
- linked audit events

## Not imported

tradeBOTZi does not import NVIDIA's Kubernetes, Helm, NemoClaw, OpenShell, Slurm, BCM, Prometheus, Grafana, or cluster-management runtime. Those solve AI-factory infrastructure operations, not portfolio management.

The trading application remains Node/TypeScript/React with its own PAPER-only execution engine and AI providers.

## Security boundary

The NVIDIA architecture keeps operational credentials in server-side tools rather than browser/MCP clients. tradeBOTZi follows the same principle: OmniRoute, FreeLLM, Ollama and Hermes credentials/endpoints stay behind the VPS backend; Hermes is not exposed directly to the public browser.

## License

The reviewed NVIDIA project is Apache License 2.0. This integration uses architecture and governance concepts with an independent implementation rather than copying its operational runtime.
