// A relative path, not '@tagreeve/core': the package index loads modules that plain node cannot strip (scripts/probe-webkit.ts imports this package).
export { consentModeChanges, unknownConsent, type ConsentModeChange, type ConsentPush } from '../../core/src/consent-command.ts';
