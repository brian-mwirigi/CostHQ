import { describe, it, expect, beforeEach } from 'vitest';
import { clearAllData, setConfig, _testDb } from '../src/db';
import { setTeamIdentity, clearTeamIdentity } from '../pro/src/team';
import {
  logAuditEvent,
  getAuditLog,
  verifyAuditIntegrity,
  exportAuditLog
} from '../pro/src/audit';

beforeEach(() => {
  clearAllData();
  clearTeamIdentity();
  _testDb.exec("DELETE FROM config;");
  _testDb.exec("DELETE FROM audit_log;");
});

describe('Tamper-Evident Logging', () => {
  it('logs an event and generates a checksum', () => {
    const event = logAuditEvent('session.start', { sessionId: 1 });
    expect(event).not.toBeNull();
    expect(event!.eventType).toBe('session.start');
    expect(event!.checksum).toHaveLength(64); // SHA-256 hex is 64 chars
  });

  it('chains checksums sequentially', () => {
    const e1 = logAuditEvent('session.start', { id: 1 });
    const e2 = logAuditEvent('ai.usage', { tokens: 100 });
    const e3 = logAuditEvent('session.end', { id: 1 });

    expect(e1!.checksum).not.toBe(e2!.checksum);
    expect(e2!.checksum).not.toBe(e3!.checksum);

    // Verify integrity passes
    const integrity = verifyAuditIntegrity();
    expect(integrity.valid).toBe(true);
    expect(integrity.checkedEvents).toBe(3);
  });

  it('tags events with team identity if configured', () => {
    // Set identity via pro/src/team
    setTeamIdentity({ team: 'Engineering', member: 'Alice' });
    
    const event = logAuditEvent('policy.change', { rule: 'block-gpt4' });
    expect(event!.teamId).toBe('Engineering');
    expect(event!.actor).toContain('Alice');
  });
});

describe('Integrity Verification', () => {
  it('returns valid for an empty log', () => {
    const integrity = verifyAuditIntegrity();
    expect(integrity.valid).toBe(true);
    expect(integrity.checkedEvents).toBe(0);
  });

  it('detects tampering (modification)', () => {
    logAuditEvent('session.start', { id: 100 });
    logAuditEvent('ai.usage', { cost: 5.0 });
    logAuditEvent('session.end', { id: 100 });

    // Directly alter the database to bypass the append-only functions
    _testDb.exec("UPDATE audit_log SET details = '{\"cost\":0}' WHERE event_type = 'ai.usage'");

    const integrity = verifyAuditIntegrity();
    expect(integrity.valid).toBe(false);
    expect(integrity.message).toContain('Integrity broken');
  });

  it('detects tampering (deletion)', () => {
    logAuditEvent('e1', { a: 1 } as any);
    logAuditEvent('e2', { a: 2 } as any);
    logAuditEvent('e3', { a: 3 } as any);

    // Delete the middle event
    _testDb.exec("DELETE FROM audit_log WHERE details LIKE '%\"a\":2%'");

    const integrity = verifyAuditIntegrity();
    expect(integrity.valid).toBe(false);
  });
});

describe('Export Formats', () => {
  beforeEach(() => {
    logAuditEvent('config.change', { key: 'theme' });
    logAuditEvent('policy.change', { firewall: true });
  });

  it('exports JSON', () => {
    const json = exportAuditLog('json');
    const parsed = JSON.parse(json);
    expect(parsed.totalEvents).toBe(2);
    expect(parsed.events[0].eventType).toBe('policy.change');
    expect(parsed.events[1].eventType).toBe('config.change');
  });

  it('exports CSV', () => {
    const csv = exportAuditLog('csv');
    const lines = csv.split('\n');
    expect(lines).toHaveLength(3); // 1 header + 2 events
    expect(lines[0]).toBe('id,timestamp,eventType,actor,teamId,details,checksum');
    expect(lines[1]).toContain('policy.change');
    expect(lines[2]).toContain('config.change');
  });

  it('exports SOC2 format with integrity metadata', () => {
    const soc2 = exportAuditLog('soc2');
    const parsed = JSON.parse(soc2);
    expect(parsed.format).toBe('costhq-audit-soc2-v1');
    expect(parsed.compliance.chainIntegrity).toBe(true);
    expect(parsed.compliance.verifiedEvents).toBe(2);
    expect(parsed.events).toHaveLength(2);
  });
});
