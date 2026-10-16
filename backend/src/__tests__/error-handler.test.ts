import 'express-async-errors';
import { describe, it, expect, afterEach, vi } from 'vitest';
import express, { type Request, type Response } from 'express';
import request from 'supertest';
import { DrizzleQueryError } from 'drizzle-orm';
import pino from 'pino';
import { Writable } from 'node:stream';
import { AppError, createErrorHandler, notFoundHandler } from '../api/middleware/error-handler.js';

/** A real pino logger writing JSON lines into an array. */
function capturingLogger() {
  const lines: Array<Record<string, unknown>> = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(JSON.parse(chunk.toString()));
      cb();
    },
  });
  return { log: pino({ level: 'info' }, stream), lines };
}

function appThrowing(err: unknown, log = pino({ level: 'silent' })) {
  const app = express();
  app.get('/boom', async (_req: Request, _res: Response) => {
    throw err;
  });
  app.use(notFoundHandler);
  app.use(createErrorHandler(log));
  return app;
}

const originalNodeEnv = process.env.NODE_ENV;
afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
});

describe('error handler', () => {
  it('answers an AppError with its status and message', async () => {
    const res = await request(appThrowing(new AppError(409, 'Already exists'))).get('/boom');
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Already exists');
  });

  it('honours a statusCode assigned onto a plain Error', async () => {
    const err = Object.assign(new Error('Gone for good'), { statusCode: 410 });
    const res = await request(appThrowing(err)).get('/boom');
    expect(res.status).toBe(410);
    expect(res.body.error).toBe('Gone for good');
  });

  it('turns an unexpected error into a 500 with a generic message', async () => {
    const res = await request(appThrowing(new Error('db password is hunter2'))).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Internal Server Error');
  });

  it('hides the message of a 5xx that is not an AppError', async () => {
    const err = Object.assign(new Error('socket hang up at 10.0.0.3'), { statusCode: 503 });
    const res = await request(appThrowing(err)).get('/boom');
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('Internal Server Error');
  });

  it('keeps the client-facing message of a 5xx AppError', async () => {
    const res = await request(
      appThrowing(new AppError(502, 'The Sia indexer did not answer; try again')),
    ).get('/boom');
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('The Sia indexer did not answer; try again');
  });

  it('maps a postgres invalid_text_representation error to a 400', async () => {
    const err = Object.assign(new Error('invalid input syntax for type uuid: "nope"'), {
      code: '22P02',
    });
    const res = await request(appThrowing(err)).get('/boom');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid identifier format' });
  });

  it('maps the same error when drizzle wraps it in a query error', async () => {
    const pg = Object.assign(new Error('invalid input syntax for type uuid: "nope"'), {
      code: '22P02',
    });
    const err = new DrizzleQueryError('select 1 where id = $1', ['nope'], pg);
    const res = await request(appThrowing(err)).get('/boom');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid identifier format' });
  });

  it('includes the message and stack outside production', async () => {
    process.env.NODE_ENV = 'test';
    const res = await request(appThrowing(new Error('kaboom'))).get('/boom');
    expect(res.body.message).toBe('kaboom');
    expect(res.body.stack).toContain('Error: kaboom');
  });

  it('leaves the message and stack out in production', async () => {
    process.env.NODE_ENV = 'production';
    const res = await request(appThrowing(new Error('kaboom'))).get('/boom');
    expect(res.body).toEqual({ error: 'Internal Server Error' });
  });

  it('logs a client error at warn, with the request and the status it answered', async () => {
    const { log, lines } = capturingLogger();
    await request(appThrowing(new AppError(422, 'bad'), log)).get('/boom?x=1');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: 40,
      msg: 'Request rejected',
      method: 'GET',
      url: '/boom?x=1',
      statusCode: 422,
    });
    expect((lines[0].err as { message: string }).message).toBe('bad');
  });

  it('logs a server error at error', async () => {
    const { log, lines } = capturingLogger();
    await request(appThrowing(new Error('kaboom'), log)).get('/boom');
    expect(lines[0]).toMatchObject({ level: 50, msg: 'Request failed', statusCode: 500 });
  });

  it('sends the details of an AppError', async () => {
    const details = [{ field: 'title', message: 'title must not be empty' }];
    const res = await request(appThrowing(new AppError(400, 'bad title', details))).get('/boom');
    expect(res.status).toBe(400);
    expect(res.body.details).toEqual(details);
  });

  it.each([
    ['23502', 'A required value is missing'],
    ['22001', 'A value is too long'],
    ['22003', 'A number is out of range'],
    ['22021', 'A text value contains a byte sequence that is not valid text'],
  ])('maps the client-caused postgres error %s to a 400', async (code, message) => {
    const pg = Object.assign(new Error('postgres says no'), { code });
    const err = new DrizzleQueryError('insert into t values ($1)', ['x'], pg);
    const res = await request(appThrowing(err)).get('/boom');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: message });
  });

  it('hands an error after the response started to express instead of answering again', () => {
    const handler = createErrorHandler(pino({ level: 'silent' }));
    const status = vi.fn();
    const next = vi.fn();
    const err = new Error('stream broke');
    handler(
      err,
      { method: 'GET', url: '/v1/objects/x' } as Request,
      { headersSent: true, status } as unknown as Response,
      next,
    );
    expect(next).toHaveBeenCalledWith(err);
    expect(status).not.toHaveBeenCalled();
  });
});

describe('not found handler', () => {
  it('answers JSON naming the method and path', async () => {
    const res = await request(appThrowing(new Error('unused'))).post('/nowhere?q=1');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Route POST /nowhere not found' });
  });
});
