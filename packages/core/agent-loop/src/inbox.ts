/**
 * Compatibility re-export: the durable Inbox implementation and its
 * projection definition live in `@deepseek-ai/dsh-agent` (the Agent contract
 * package) so every driver shares them without depending on the agent-loop
 * package. This shim keeps historical import sites working.
 *
 * @module @deepseek-ai/dsh-agent-loop/inbox
 */

export {
  AgentInbox,
  AgentInbox as ReactLoopInbox,
  inboxProjectionDefinition,
  inboxProjectionSchema,
} from '@deepseek-ai/dsh-agent'
