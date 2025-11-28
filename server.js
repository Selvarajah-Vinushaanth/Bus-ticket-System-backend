const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const ChatAssistant = require('./services/chatAssistant');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Initialize Chat Assistant
const chatAssistant = new ChatAssistant(process.env.GEMINI_API_KEY, supabase);


const app=express();
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

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

  // Check if password matches the one in database
  if (data.password && password !== data.password) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

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

// -------------------- Chat Assistant --------------------
app.post('/api/chat', async (req, res) => {
  try {
    const { question } = req.body;
    
    if (!question || question.trim() === '') {
      return res.status(400).json({ error: 'Question is required' });
    }

    const result = await chatAssistant.processQuestion(question);
    res.json(result);
  } catch (error) {
    console.error('Chat endpoint error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error',
      details: error.message 
    });
  }
});

app.post('/api/chat/conversation', async (req, res) => {
  try {
    const { messages, conductorId, conductorRoute } = req.body;
    
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Messages array is required' });
    }

    const result = await chatAssistant.processConversation(messages, conductorId, conductorRoute);
    res.json(result);
  } catch (error) {
    console.error('Conversation endpoint error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error',
      details: error.message 
    });
  }
});

// Get chat history for a conductor
app.get('/api/chat/history/:conductorId', async (req, res) => {
  try {
    const { conductorId } = req.params;
    const limit = parseInt(req.query.limit) || 50;
    
    const history = await chatAssistant.getChatHistory(parseInt(conductorId), limit);
    res.json({ success: true, history });
  } catch (error) {
    console.error('Chat history endpoint error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error',
      details: error.message 
    });
  }
});

// Clear chat history for a conductor
app.delete('/api/chat/history/:conductorId', async (req, res) => {
  try {
    const { conductorId } = req.params;
    
    const success = await chatAssistant.clearChatHistory(parseInt(conductorId));
    
    if (success) {
      res.json({ success: true, message: 'Chat history cleared' });
    } else {
      res.status(500).json({ success: false, error: 'Failed to clear chat history' });
    }
  } catch (error) {
    console.error('Clear chat history endpoint error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error',
      details: error.message 
    });
  }
});

// AI-powered ticket generation from natural language
app.post('/api/tickets/generate', async (req, res) => {
  try {
    const { prompt, conductorId, conductorRoute } = req.body;
    
    if (!prompt || !conductorId) {
      return res.status(400).json({ error: 'Prompt and conductorId are required' });
    }

    const result = await chatAssistant.generateTicketFromPrompt(prompt, conductorId, conductorRoute);
    res.json(result);
  } catch (error) {
    console.error('AI ticket generation error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error',
      details: error.message 
    });
  }
});

// -------------------- Start Server --------------------
app.listen(PORT, () => console.log(`🚍 Supabase Bus System running on port ${PORT}`));
