import bodyParser from 'body-parser';
import express from 'express';
import fetch from 'node-fetch'; // Make sure to install node-fetch if not already
import { BASE_NODE_PORT } from '../config';
import { Value } from '../types';

// Assuming Value is '0' | '1' | '?'
type NodeState = {
  killed: boolean;
  x: Value;
  decided: boolean | null;
  k: number;
};

export async function node(
  nodeId: number,
  N: number,
  F: number,
  initialValue: Value,
  isFaulty: boolean,
  nodesAreReady: () => boolean,
  setNodeIsReady: (index: number) => void
) {
  const node = express();
  node.use(express.json());
  node.use(bodyParser.json());

  let currentState: NodeState = {
    killed: false,
    x: initialValue,
    decided: false,
    k: 0,
  };

  let receivedValues: Value[] = [];

  // Utility function to broadcast the current state to all other nodes
  async function broadcastState() {
    for (let i = 0; i < N; i++) {
      if (i !== nodeId) { // Skip sending message to itself
        try {
          await fetch(`http://localhost:${BASE_NODE_PORT + i}/message`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fromNodeId: nodeId,
              round: currentState.k,
              value: currentState.x,
            }),
          });
        } catch (error) {
          console.error(`Failed to send message to node ${i}:`, error);
        }
      }
    }
  }

  // Logic to decide on a value for the next round
  function decideValue() {
    const counts = { '0': 0, '1': 0, '?': 0 };
    receivedValues.forEach(val => counts[val]++);
    
    // Check for majority
    for (let val of ['0', '1'] as const) { // 'as const' narrows down the type from string[] to ('0' | '1')[]
      if (counts[val] > N / 2) return val;
    }

    // If no majority and the node is not faulty, choose randomly (simulate randomness for demonstration)
    return Math.random() > 0.5 ? '1' : '0';
  }

  function initiateRound() {
    // Increment round
    currentState.k += 1;

    // Broadcast current state to all nodes
    broadcastState().then(() => {
      // Decide on the next value after some time to allow all messages to be received
      setTimeout(() => {
        const nextValue: Value = decideValue() as Value;
        receivedValues = []; // Reset received values for the next round
        currentState.x = nextValue;

        console.log(`Node ${nodeId} new state:`, currentState);

        // Example stopping condition (not part of the actual Ben-Or algorithm)
        if (currentState.k >= 5) { // For demonstration, stop after 5 rounds
          console.log(`Node ${nodeId} final state:`, currentState);
          currentState.decided = true;
        } else {
          initiateRound();
        }
      }, 3000); // Wait 3 seconds to simulate delay in gathering all messages
    });
  }

  node.get("/status", (req, res) => {
    if (isFaulty) {
      res.status(500).send("faulty");
    } else {
      res.status(200).send("live");
    }
  });

  node.post("/message", (req, res) => {
    if (!currentState.killed && !isFaulty) {
      const { value } = req.body;
      receivedValues.push(value);
      res.status(200).send("Message processed");
    } else {
      res.status(500).send("Node is not participating");
    }
  });

  node.get("/start", async (req, res) => {
    if (currentState.decided || isFaulty) {
      res.status(400).send("Node cannot start");
      return;
    }
  
    console.log(`Node ${nodeId} starting consensus process`);
    initiateRound();
  
    res.send("Consensus process started");
  });

  node.get("/stop", async (req, res) => {
    console.log(`Node ${nodeId} stopping consensus process`);
    currentState.killed = true;
    res.send("Node stopped participating");
  });

  node.get("/getState", (req, res) => {
    res.json(currentState);
  });

  const server = node.listen(BASE_NODE_PORT + nodeId, async () => {
    console.log(`Node ${nodeId} is listening on port ${BASE_NODE_PORT + nodeId}`);
    setNodeIsReady(nodeId);
  });

  return server;
}
