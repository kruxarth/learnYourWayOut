Build a gamified e-learning game where the player escapes a maze by solving learning
challenges across multiple stages. Each stage poses questions, puzzles, or tasks — a correct
answer advances the player, while a wrong answer can trigger penalties, dead ends, alternate
paths, or harder questions. Before entering, the player picks a learning domain (math, science,
history, programming, etc.) and/or difficulty level, and the system selects or generates matching
challenges. In engineering terms, you're building a loop: domain/difficulty selection → maze
generation or loading → player navigation → challenge at checkpoint → answer evaluation →
progression or penalty → win/lose check.
What You Must Deliver
A working playable prototype with a functional maze and navigation system, multiple
stages/challenge points, a working question system, domain/difficulty selection, player decisions
that affect progression, and clear success/failure conditions — plus source code, brief technical
documentation, and a short demo/presentation. A large question bank or full e-learning platform
isn't required; the focus is a working gameplay loop tying learning challenges to maze
progression.
Tools and Tech Stack
Build in Unity, Unreal Engine, or Godot, or go web-based with HTML/CSS/JavaScript, Phaser.js,
or p5.js; Pygame works as a lightweight option. Use maze-generation algorithms like DFS
backtracker, Prim's, or Kruskal's for the core structure, and consider AI/LLM APIs or
question-generation models for dynamic content, with JSON, SQLite, or Firebase storing
question banks and player progress. REST APIs can fetch quiz content, Computer Vision/OCR
can turn scanned notes or textbooks into questions, and Node.js, Flask, or FastAPI can power
an optional backend, with Git/GitHub and Figma rounding out planning and version control.
Theme Examples: Domain Selection, Difficulty Selection, Branching Maze, Progressive
Difficulty, Time-Based Challenges, Knowledge Power-Ups, AI-Generated Questions
