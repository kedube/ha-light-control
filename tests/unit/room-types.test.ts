import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isOutdoorName, roomType } from '../../src/room-types.ts';

describe('roomType', () => {
  it('recognizes rooms by name in the card’s languages', () => {
    assert.equal(roomType('Living Room'), 'living');
    assert.equal(roomType('Wohnzimmer'), 'living');
    assert.equal(roomType('Keuken'), 'kitchen');
    assert.equal(roomType('Salle à manger'), 'dining');
    assert.equal(roomType('Dormitorio'), 'bedroom');
    assert.equal(roomType('Bagno'), 'bathroom');
    assert.equal(roomType('Biuro'), 'office');
    assert.equal(roomType('Garagem'), 'garage');
    assert.equal(roomType('Media Room'), 'media');
  });

  it('prefers the specific room over the general word inside it', () => {
    assert.equal(roomType('Kids Bedroom'), 'kids');
    assert.equal(roomType('Guest Bedroom'), 'guest');
    assert.equal(roomType('Master Bathroom'), 'bathroom');
    assert.equal(roomType('Dining Room'), 'dining');
  });

  it('keeps outdoor types for outdoor areas', () => {
    assert.equal(roomType('Front Porch', null, isOutdoorName('Front Porch')), 'porch');
    assert.equal(roomType('Garden', null, true), 'garden');
    assert.equal(roomType('Driveway', null, true), 'driveway');
    assert.equal(roomType('Pool Room', null, isOutdoorName('Pool Room')), 'room', 'a pool room is indoors');
  });

  it('falls back to the area icon, then to an ordinary room', () => {
    assert.equal(roomType('Zzz', 'mdi:bed'), 'bedroom');
    assert.equal(roomType('Zzz', 'mdi:rocket'), 'room');
    assert.equal(roomType('Zzz', null, true), 'garden');
  });
});
