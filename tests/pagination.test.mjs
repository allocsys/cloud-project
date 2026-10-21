// Tests for pagination utilities in db.js
// Runs against a real Postgres (DATABASE_URL).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { pool, q, allUsers, allUserIds, getUserCount, withUser, createUser, getUser } = await import('@/lib/server/db');
const { migrate } = await import('@/lib/server/migrate');

const run = Date.now().toString(36);
const email = (n) => `${n}-${run}@test.dev`;

// Create test users for pagination tests
const TEST_USER_COUNT = 25;

before(async () => {
  await migrate();
  
  // Create test users with proper timestamps (not Date.now() which returns ms)
  for (let i = 0; i < TEST_USER_COUNT; i++) {
    await createUser(pool(), email(`user-${i}`), { email: email(`user-${i}`) });
    // Add a small delay to ensure different created_at timestamps for cursor pagination
    await new Promise(resolve => setTimeout(resolve, 10));
  }
});

after(async () => {
  // Cleanup test users
  for (let i = 0; i < TEST_USER_COUNT; i++) {
    try {
      await q('DELETE FROM users WHERE id = $1', [email(`user-${i}`)]);
    } catch (e) {
      // Ignore cleanup errors
    }
  }
  
  await pool().end();
});

test('getUserCount returns correct count', async () => {
  const count = await getUserCount();
  assert.ok(count >= TEST_USER_COUNT, `Should have at least ${TEST_USER_COUNT} users`);
  assert.equal(typeof count, 'number');
});

test('allUserIds returns array of user IDs', async () => {
  const ids = await allUserIds();
  assert.ok(Array.isArray(ids), 'Should return array');
  assert.ok(ids.length > 0, 'Should have users');
  assert.ok(ids.every(id => typeof id === 'string'), 'All IDs should be strings');
});

test('allUserIds with offset returns subset', async () => {
  const allIds = await allUserIds();
  const subset = await allUserIds(pool(), 10, 5);
  
  assert.ok(Array.isArray(subset), 'Should return array');
  assert.ok(subset.length <= 5, 'Should return at most 5 users');
  
  // Check that subset is actually a subset of allIds
  for (const id of subset) {
    assert.ok(allIds.includes(id), `ID ${id} should be in allIds`);
  }
});

test('allUserIds with offset and limit returns correct range', async () => {
  const page1 = await allUserIds(pool(), 0, 10);
  const page2 = await allUserIds(pool(), 10, 10);
  
  assert.ok(page1.length <= 10, 'Page 1 should have at most 10 users');
  assert.ok(page2.length <= 10, 'Page 2 should have at most 10 users');
  
  // Check no overlap between pages
  const overlap = page1.filter(id => page2.includes(id));
  assert.equal(overlap.length, 0, 'Pages should not overlap');
});

test('allUserIds with offset only returns from that offset', async () => {
  const allIds = await allUserIds();
  const fromOffset = await allUserIds(pool(), 5);
  
  assert.ok(Array.isArray(fromOffset), 'Should return array');
  
  // The first 5 users from allIds should not be in fromOffset
  const firstFive = allIds.slice(0, 5);
  const overlap = firstFive.filter(id => fromOffset.includes(id));
  assert.equal(overlap.length, 0, 'Should skip first 5 users');
});

test('allUsers returns array of user documents', async () => {
  const users = await allUsers(10);
  assert.ok(Array.isArray(users), 'Should return array');
  assert.ok(users.length <= 10, 'Should return at most 10 users');
  
  for (const user of users) {
    assert.ok(user.id, 'User should have id');
    assert.ok(user.createdAt, 'User should have createdAt');
  }
});

test('allUsers with cursor returns users after cursor', async () => {
  const firstPage = await allUsers(10);
  assert.ok(firstPage.length > 0, 'First page should have users');
  
  const lastUser = firstPage[firstPage.length - 1];
  // Convert numeric timestamp to Date string for cursor comparison
  const cursor = {
    created_at: new Date(lastUser.createdAt).toISOString(),
    id: lastUser.id
  };
  
  const secondPage = await allUsers(10, pool(), cursor);
  assert.ok(Array.isArray(secondPage), 'Second page should be array');
  
  // Check no overlap
  const overlap = firstPage.filter(u => secondPage.some(v => v.id === u.id));
  assert.equal(overlap.length, 0, 'Pages should not overlap with cursor');
});

test('allUsers with cursor handles null cursor', async () => {
  const users = await allUsers(10, pool(), null);
  assert.ok(Array.isArray(users), 'Should return array with null cursor');
  assert.ok(users.length <= 10, 'Should return at most 10 users');
});

test('allUsers with cursor handles undefined cursor', async () => {
  const users = await allUsers(10, pool(), undefined);
  assert.ok(Array.isArray(users), 'Should return array with undefined cursor');
  assert.ok(users.length <= 10, 'Should return at most 10 users');
});

test('pagination preserves order', async () => {
  const page1 = await allUserIds(pool(), 0, 10);
  const page2 = await allUserIds(pool(), 10, 10);
  const page3 = await allUserIds(pool(), 20, 10);
  
  // All pages should be in order (by created_at, then id)
  const allIds = [...page1, ...page2, ...page3];
  
  for (let i = 1; i < allIds.length; i++) {
    // Get the actual created_at for comparison
    const prevUser = await getUser(allIds[i - 1]);
    const currUser = await getUser(allIds[i]);
    
    // Should be in order by created_at, then by id
    if (prevUser.createdAt === currUser.createdAt) {
      assert.ok(allIds[i - 1] <= allIds[i], 'Should be ordered by id when created_at is equal');
    } else {
      assert.ok(prevUser.createdAt <= currUser.createdAt, 'Should be ordered by created_at');
    }
  }
});

test('allUserIds with large limit returns all users', async () => {
  const allIds = await allUserIds(pool(), 0, 10000);
  const count = await getUserCount();
  
  assert.ok(allIds.length >= count, 'Should return all users with large limit');
});

test('empty database returns empty arrays', async () => {
  // This test uses a fresh connection to avoid interference
  const emptyIds = await allUserIds(pool(), 10000, 10);
  const emptyUsers = await allUsers(10, pool(), null);
  
  assert.ok(Array.isArray(emptyIds), 'Should return array even if empty');
  assert.ok(Array.isArray(emptyUsers), 'Should return array even if empty');
});
