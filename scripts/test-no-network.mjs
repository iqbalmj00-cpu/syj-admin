import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';
const blocked = () => { throw new Error('Network disabled for Admin handoff verification'); };
net.connect = blocked; net.createConnection = blocked; net.Socket.prototype.connect = blocked;
tls.connect = blocked; http.request = blocked; http.get = blocked; https.request = blocked; https.get = blocked;
globalThis.fetch = blocked;
