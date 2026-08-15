import React, { useEffect, useRef, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';

// This route implements the locked visual system (CSS + animation)
// and wires a unified typing -> addComment pipeline plus reverse-chron
// pagination across multiple posts (mocked). Keep the visual styles
// and animation timing identical to the original snippet.

export const Route = createFileRoute('/dev/comments')({
  component: DevComments,
});

function DevComments() {
  const feedRef = useRef<HTMLDivElement | null>(null);
  const typingRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [count, setCount] = useState(3);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [nextPostIndex, setNextPostIndex] = useState(1); // 0 loaded initially

  // Mock posts: newest first
  const POSTS: Array<{ id: string; title: string; ts: string; comments: Array<{ name: string; text: string }> }> = [
    {
      id: 'post-0',
      title: 'Current Post',
      ts: 'Just now',
      comments: [
        { name: 'David O.', text: 'This is such a clean feature, love the motion on it.' },
        { name: 'Chinedu N.', text: 'How did you get the typing bubble to feel so springy?' },
        { name: 'Aisha B.', text: 'Same easing curve as the message drop-in 👀' },
      ],
    },
    {
      id: 'post-1',
      title: 'Older Post #1',
      ts: '2 days ago',
      comments: [
        { name: 'Liam R.', text: 'This older thread had some nice ideas.' },
        { name: 'Maya P.', text: 'Bringing this back, interesting.' },
      ],
    },
    {
      id: 'post-2',
      title: 'Older Post #2',
      ts: 'Apr 5',
      comments: [
        { name: 'Sam K.', text: 'Legacy discussion, but still relevant.' },
      ],
    },
  ];

  // Avatar colors used by the locked system
  const avatarColors = ['#e0637a', '#5b8cff', '#3fb27f', '#c98a3e', '#8a63e0'];

  function initials(name: string) {
    return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  }

  // Keep the DOM creation identical to original so CSS classes apply
  function createRowNode({ name, text, mine = false }: { name?: string; text: string; mine?: boolean }) {
    const row = document.createElement('div');
    row.className = 'row enter' + (mine ? ' mine' : '');

    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.style.background = avatarColors[Math.floor(Math.random() * avatarColors.length)];
    avatar.textContent = mine ? 'Y' : (name ? initials(name) : '??');

    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.innerHTML = mine ? `<p></p>` : `<div class="name">${name}</div><p></p>`;
    bubble.querySelector('p')!.textContent = text;

    if (!mine) row.appendChild(avatar);
    row.appendChild(bubble);
    if (mine) row.appendChild(avatar);

    return row;
  }

  // Create a post block containing the post node (avatar + title) and a
  // comments container. The thread-line visually links the node to comments.
  function createPostBlock(post: { id?: string; title: string; ts: string }) {
    const block = document.createElement('div');
    block.className = 'post-block';

    const node = document.createElement('div');
    node.className = 'post-node enter';

    const avatar = document.createElement('div');
    avatar.className = 'avatar avatar--post';
    avatar.style.background = avatarColors[Math.floor(Math.random() * avatarColors.length)];
    avatar.textContent = 'P';

    const title = document.createElement('div');
    title.className = 'post-title';
    title.textContent = `${post.title} — ${post.ts}`;

    node.appendChild(avatar);
    node.appendChild(title);

    const thread = document.createElement('div');
    thread.className = 'thread-line';

    const commentsContainer = document.createElement('div');
    commentsContainer.className = 'post-comments';

    block.appendChild(node);
    block.appendChild(thread);
    block.appendChild(commentsContainer);

    return block;
  }

  // showTyping must be identical in look & timing to locked system
  function showTyping(ms = 1400) {
    const typingRow = typingRef.current!;
    const feed = feedRef.current!;
    // Only auto-scroll to bottom if the user is already near the bottom.
    const distanceFromBottom = Math.abs(feed.scrollHeight - (feed.scrollTop + feed.clientHeight));
    const atBottom = distanceFromBottom < 48; // small threshold

    typingRow.classList.add('show');
    if (atBottom) feed.scrollTop = feed.scrollHeight;

    return new Promise<void>((res) => setTimeout(() => {
      typingRow.classList.remove('show');
      res();
    }, ms));
  }

  function addCommentDOM(node: HTMLElement) {
    const feed = feedRef.current!;
    const typingRow = typingRef.current!;
    // Append to the most recent post-block's comments container. If none,
    // fall back to inserting directly before the typing row.
    const lastBlock = feed.querySelector('.post-block:last-of-type') as HTMLElement | null;
    if (lastBlock) {
      const comments = lastBlock.querySelector('.post-comments')!;
      comments.appendChild(node);
    } else {
      feed.insertBefore(node, typingRow);
    }
    feed.scrollTop = feed.scrollHeight;
    setCount((c) => c + 1);
  }

  // Unified pipeline: every comment (user, other, automated) should go through showTyping -> addComment
  async function pipelineAdd({ name, text, mine = false }: { name?: string; text: string; mine?: boolean }) {
    await showTyping(1300 + Math.random() * 800);
    const node = createRowNode({ name, text, mine });
    addCommentDOM(node);
  }

  // Initial mount: render the initial post's comments directly (but still animate)
  useEffect(() => {
    (async () => {
      const feed = feedRef.current!;
      const typingRow = typingRef.current!;
      // Create the initial post block (current post) and insert before typing row
      const initial = POSTS[0];
      const block = createPostBlock(initial);
      feed.insertBefore(block, typingRow);

      // Add initial comments into that block via the same pipeline (keeps animation consistent)
      for (const c of initial.comments) {
        await pipelineAdd({ name: c.name, text: c.text, mine: false });
        await new Promise((r) => setTimeout(r, 120));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mock fetch older post (simulates network latency)
  function fetchOlderPost(index: number) {
    return new Promise<typeof POSTS[0]>((res) => {
      setTimeout(() => res(POSTS[index]), 700 + Math.random() * 400);
    });
  }

  // IntersectionObserver sentinel observer to load older posts when we near bottom
  useEffect(() => {
    const sentinel = document.getElementById('feed-sentinel');
    if (!sentinel) return;
    const io = new IntersectionObserver(async (entries) => {
      for (const e of entries) {
        if (e.isIntersecting && !loadingOlder && nextPostIndex < POSTS.length) {
          setLoadingOlder(true);
          const feed = feedRef.current!;
          const typingRow = typingRef.current!;
          // preserve scroll position: measure before inserting
          const prevScrollTop = feed.scrollTop;
          const prevScrollHeight = feed.scrollHeight;

          // fetch the next post batch
          const post = await fetchOlderPost(nextPostIndex);
          // Create a post-block and insert it before the first existing block/comment
          const firstBlock = feed.querySelector('.row, .post-block');
          const newBlock = createPostBlock(post);
          if (firstBlock) {
            feed.insertBefore(newBlock, firstBlock);
          } else {
            feed.insertBefore(newBlock, typingRow);
          }

          // Insert comments into the new block so their order is oldest -> newest
          const comments = post.comments.slice();
          const commentsContainer = newBlock.querySelector('.post-comments')!;
          for (let i = 0; i < comments.length; i++) {
            const c = comments[i];
            const node = createRowNode({ name: c.name, text: c.text, mine: false });
            commentsContainer.appendChild(node);
            // small stagger for the animation
            await new Promise((r) => setTimeout(r, 160));
          }

          // restore scroll top so viewport doesn't jump (keep same visual offset)
          const newScrollHeight = feed.scrollHeight;
          const delta = newScrollHeight - prevScrollHeight;
          feed.scrollTop = prevScrollTop + delta;

          setNextPostIndex((i) => i + 1);
          setLoadingOlder(false);
        }
      }
    }, { root: feedRef.current, threshold: 0.1 });
    io.observe(sentinel);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingOlder, nextPostIndex]);

  // Send handler: user message then immediate auto reply (via same pipeline)
  function send() {
    const input = inputRef.current!;
    const text = input.value.trim();
    if (!text) return;
    // user's message (mine) must also pass through typing->add to keep unified entrance
    (async () => {
      await pipelineAdd({ text, mine: true });
      input.value = '';
      // simulate someone else replying immediately via the same pipeline
      setTimeout(async () => {
        await pipelineAdd({ name: 'AutoBot', text: 'How are you doing? I want to see how the design is okayyy' });
      }, 300);
    })();
  }

  return (
    <div>
      <style>{`\
  :root{\
    --bg: #0f1115;\
    --panel: #171a21;\
    --bubble: #1f2430;\
    --bubble-alt: #232a3a;\
    --text: #e8eaf0;\
    --text-dim: #8b91a3;\
    --accent: #5b8cff;\
    --accent-glow: rgba(91,140,255,0.35);\
    --radius: 18px;\
  }\
  *{ box-sizing: border-box; }\
  body{ margin:0; }\
  .phone{ width: 390px; max-width: 100vw; height: 720px; background: var(--panel); border-radius: 32px; overflow: hidden; display: flex; flex-direction: column; box-shadow: 0 40px 80px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04); }\
  .header{ padding: 18px 20px 14px; border-bottom: 1px solid rgba(255,255,255,0.06); display:flex; align-items:center; justify-content:space-between; }\
  .header h1{ font-size: 15px; font-weight: 600; color: var(--text); margin:0; letter-spacing: 0.2px; }\
  .header span{ font-size: 12px; color: var(--text-dim); }\
  .feed{ flex:1; overflow-y: auto; padding: 18px 16px 8px; display:flex; flex-direction:column; gap: 14px; scrollbar-width: none; }\
  .feed::-webkit-scrollbar{ display:none; }\
  .row{ display:flex; gap: 10px; align-items: flex-end; }\
  .avatar{ width: 30px; height: 30px; border-radius: 50%; flex-shrink:0; display:flex; align-items:center; justify-content:center; font-size: 12px; font-weight: 700; color: #fff; }\
  .row.enter{ animation: dropIn 0.62s cubic-bezier(0.34, 1.56, 0.64, 1) both; transform-origin: bottom left; }\
  @keyframes dropIn{ 0%{ opacity: 0; transform: translateY(26px) scale(0.85); } 60%{ opacity: 1; transform: translateY(-4px) scale(1.02); } 100%{ opacity: 1; transform: translateY(0) scale(1); } }\
  .bubble{ background: var(--bubble); padding: 10px 14px; border-radius: var(--radius); border-bottom-left-radius: 4px; max-width: 78%; }\
  .row.mine{ justify-content:flex-end; }\
  .row.mine .bubble{ background: var(--accent); border-bottom-left-radius: var(--radius); border-bottom-right-radius: 4px; }\
  .bubble .name{ font-size: 12px; font-weight: 700; color: var(--accent); margin-bottom: 2px; }\
  .row.mine .bubble .name{ display:none; }\
  .bubble p{ margin:0; font-size: 14.5px; line-height: 1.35; color: var(--text); }\
  .typing-row{ display:flex; align-items:center; gap: 10px; height: 0; opacity: 0; overflow: hidden; transition: height 0.35s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.25s ease; }\
  .typing-row.show{ height: 40px; opacity: 1; }\
  .typing-bubble{ background: var(--bubble-alt); border-radius: var(--radius); border-bottom-left-radius: 4px; padding: 11px 16px; display:flex; gap: 5px; align-items:center; }\
  .typing-bubble .dot{ width: 7px; height: 7px; border-radius: 50%; background: var(--text-dim); animation: elasticBounce 1s cubic-bezier(0.45, 0, 0.55, 1) infinite; }\
  .typing-bubble .dot:nth-child(2){ animation-delay: 0.15s; }\
  .typing-bubble .dot:nth-child(3){ animation-delay: 0.3s; }\
  @keyframes elasticBounce{ 0%, 60%, 100%{ transform: translateY(0) scale(1); } 25%{ transform: translateY(-7px) scale(1.15); } }\
  .typing-label{ font-size: 12px; color: var(--text-dim); animation: fadeFlicker 2s ease-in-out infinite; }\
  @keyframes fadeFlicker{ 0%,100%{ opacity: 0.6; } 50%{ opacity: 1; } }\
  .composer{ padding: 12px 14px 18px; border-top: 1px solid rgba(255,255,255,0.06); display:flex; gap: 10px; align-items:center; }\
  .composer input{ flex:1; background: var(--bubble); border: 1px solid rgba(255,255,255,0.06); border-radius: 999px; padding: 11px 16px; color: var(--text); font-size: 14px; outline: none; transition: box-shadow 0.2s ease, border-color 0.2s ease; }\
  .composer input:focus{ border-color: var(--accent); box-shadow: 0 0 0 4px var(--accent-glow); }\
  .send{ width: 38px; height: 38px; border-radius: 50%; background: var(--accent); border:none; display:flex; align-items:center; justify-content:center; cursor:pointer; flex-shrink:0; transition: transform 0.15s cubic-bezier(0.34, 1.56, 0.64, 1); }\
  .send:active{ transform: scale(0.85); }\
  .send svg{ width:16px; height:16px; }\
  .hint{ text-align:center; font-size: 11px; color: var(--text-dim); padding-bottom: 6px; }\
  /* Thread / post-node visuals */\
  .post-block{ position: relative; padding-left: 46px; display:flex; flex-direction:column; gap:8px; }\
  .post-node{ display:flex; align-items:center; gap:10px; color: var(--text); font-weight:600; font-size:13px; }\
  .post-node.enter{ animation: dropIn 0.62s cubic-bezier(0.34, 1.56, 0.64, 1) both; transform-origin: left top; }\
  .post-node .post-title{ color: var(--text-dim); font-weight:600; font-size:13px; }
  .avatar--post{ width:26px; height:26px; font-size:12px; }
  .thread-line{ position:absolute; left:28px; top:36px; bottom:0; width:2px; background: rgba(255,255,255,0.04); border-radius:2px; }
  .post-comments{ display:flex; flex-direction:column; gap:12px; padding-left: 6px; }
  .post-divider{ text-align:center; color:var(--text-dim); font-size:12px; padding:6px 0; opacity:0.9; }\
`}</style>

      <div className="phone">
        <div className="header">
          <h1>Comments</h1>
          <span id="count">{count} comments</span>
        </div>

        <div className="feed" id="feed" ref={feedRef}>
          {/* initial comments are mounted by effect using same pipeline */}

          <div className="typing-row" id="typingRow" ref={typingRef}>
            <div className="avatar" style={{ background: '#c98a3e' }}>ZG</div>
            <div className="typing-bubble">
              <span className="dot"></span><span className="dot"></span><span className="dot"></span>
            </div>
          </div>

          {/* sentinel to load older posts */}
          <div id="feed-sentinel" style={{ height: 1 }}></div>
        </div>

        <div className="hint">Type below, then hit send — watch it drop in</div>
        <div className="composer">
          <input id="input" ref={inputRef} type="text" placeholder="Write a comment…" onKeyDown={(e) => { if (e.key === 'Enter') send(); }} />
          <button className="send" id="sendBtn" aria-label="Send comment" onClick={send}>
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M22 2L11 13" stroke="white" strokeWidth="2" strokeLinecap="round"/>
              <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="white" strokeWidth="2" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
