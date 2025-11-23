const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 5000;

// -------------------- Routes API --------------------

// GET all routes
app.get('/api/routes', async (req, res) => {
  const { data, error } = await supabase.from('routes').select('*').order('route_number', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// GET route by number
app.get('/api/routes/:routeNumber', async (req, res) => {
  const { routeNumber } = req.params;
  const { data, error } = await supabase.from('routes').select('*').eq('route_number', routeNumber).single();
  if (error || !data) return res.status(404).json({ error: 'Route not found' });
  res.json(data);
});

// -------------------- Fare Calculation --------------------
app.post('/api/calculate-fare', async (req, res) => {
  const { routeNumber, passengerType } = req.body;
  const { data: route, error } = await supabase.from('routes').select('*').eq('route_number', routeNumber).single();
  if (error || !route) return res.status(404).json({ error: 'Route not found' });

  let fare = route.base_fare;
  if (passengerType === 'child') fare *= 0.5;
  if (passengerType === 'senior') fare *= 0.75;
  if (passengerType === 'student') fare *= 0.6;

  res.json({ fare: Math.round(fare) });
});

// -------------------- Ticket Creation --------------------
app.post('/api/tickets', async (req, res) => {
  const ticketNumber = `TKT-${Date.now()}-${Math.random().toString(36).substring(2, 9).toUpperCase()}`;
  const payload = {
    ticket_number: ticketNumber,
    conductor_id: Number(req.body.conductorId),
    route_number: req.body.routeNumber,
    origin: req.body.origin,
    destination: req.body.destination,
    passenger_name: req.body.passengerName,
    passenger_type: req.body.passengerType,
    passenger_count: req.body.passengerCount || 1,
    fare_amount: req.body.fareAmount,
    payment_method: req.body.paymentMethod,
    seat_number: req.body.seatNumber,
  };

  const { data, error } = await supabase.from('tickets').insert([payload]).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// -------------------- Get Tickets --------------------
app.get('/api/tickets', async (req, res) => {
  const { conductorId, date } = req.query;
  let query = supabase.from('tickets').select('*');

  if (conductorId) query = query.eq('conductor_id', Number(conductorId));
  if (date) query = query.gte('ticket_date', `${date} 00:00:00`).lte('ticket_date', `${date} 23:59:59`);

  query = query.order('ticket_date', { ascending: false });

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// -------------------- Get Ticket By Number --------------------
app.get('/api/tickets/:ticketNumber', async (req, res) => {
  const { ticketNumber } = req.params;
  const { data, error } = await supabase.from('tickets').select('*').eq('ticket_number', ticketNumber).single();
  if (error || !data) return res.status(404).json({ error: 'Ticket not found' });
  res.json(data);
});

// -------------------- Statistics --------------------
app.get('/api/statistics', async (req, res) => {
  const { conductorId, date } = req.query;

  let filters = {};
  if (conductorId) filters.conductor_id = Number(conductorId);

  const ticketsQuery = supabase.from('tickets').select('*');

  if (conductorId) ticketsQuery.eq('conductor_id', Number(conductorId));
  if (date) ticketsQuery.gte('ticket_date', `${date} 00:00:00`).lte('ticket_date', `${date} 23:59:59`);

  const { data: tickets, error } = await ticketsQuery;
  if (error) return res.status(500).json({ error: error.message });

  const totalTickets = { count: tickets.length };
  const totalRevenue = tickets.reduce((sum, t) => sum + parseFloat(t.fare_amount), 0);

  const ticketsByType = {};
  tickets.forEach(t => {
    ticketsByType[t.passenger_type] = (ticketsByType[t.passenger_type] || 0) + 1;
  });

  const ticketsByRoute = {};
  tickets.forEach(t => {
    ticketsByRoute[t.route_number] = (ticketsByRoute[t.route_number] || 0) + 1;
  });

  res.json({ totalTickets, totalRevenue, ticketsByType, ticketsByRoute });
});

// -------------------- Login --------------------
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const { data, error } = await supabase.from('conductors').select('*').eq('username', username).single();
  if (error || !data) return res.status(401).json({ error: 'Invalid credentials' });

  // Simplified password check (same as before)
  if (password !== 'admin123' && password !== 'password') return res.status(401).json({ error: 'Invalid credentials' });

  res.json({
    id: data.id,
    username: data.username,
    name: data.name,
    employeeId: data.employee_id,
    routeNumber: data.route_number,
  });
});

// -------------------- Health --------------------
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Server running' });
});

// -------------------- Start Server --------------------
app.listen(PORT, () => console.log(`🚍 Supabase Bus System running on port ${PORT}`));
