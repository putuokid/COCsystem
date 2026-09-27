// v7 shared memo: autosave + Supabase Realtime sync
window.SharedMemo = async function SharedMemo({ sessionId, textarea, status }) {
  if (!textarea || !status || !sessionId) return null;

  let saveTimer = null;
  let isTyping = false;
  let isSaving = false;
  let lastSaved = '';
  let pendingRemote = null;
  let destroyed = false;

  const setStatus = (text, cls='') => {
    status.textContent = text;
    status.className = 'memo-status ' + cls;
  };

  async function load() {
    const { data, error } = await sb.from('t_session_memo')
      .select('content,updated_at')
      .eq('session_id', sessionId)
      .maybeSingle();
    if (error) { setStatus('読込失敗: ' + error.message, 'error'); return; }
    textarea.value = data?.content || '';
    lastSaved = textarea.value;
    setStatus('保存済み ✓', 'ok');
  }

  async function save() {
    if (destroyed) return;
    clearTimeout(saveTimer);
    if (textarea.value === lastSaved) { setStatus('保存済み ✓', 'ok'); return; }
    isSaving = true;
    setStatus('保存中…');
    const content = textarea.value;
    const { error } = await sb.from('t_session_memo').upsert({
      session_id: sessionId,
      content,
      updated_at: new Date().toISOString()
    });
    isSaving = false;
    if (error) { setStatus('保存失敗: ' + error.message, 'error'); return; }
    lastSaved = content;
    setStatus('保存済み ✓', 'ok');
  }

  textarea.addEventListener('input', () => {
    isTyping = true;
    setStatus('入力中…');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 800);
  });

  textarea.addEventListener('focus', () => { isTyping = true; });
  textarea.addEventListener('blur', async () => {
    isTyping = false;
    await save();
    // 入力中に他端末から更新が来ていた場合は、保存後にDBの最新版を再確認する。
    if (pendingRemote !== null) {
      pendingRemote = null;
      const { data, error } = await sb.from('t_session_memo')
        .select('content').eq('session_id', sessionId).maybeSingle();
      if (!error && data && data.content !== textarea.value) {
        textarea.value = data.content || '';
        lastSaved = textarea.value;
        setStatus('他の参加者の更新を反映しました', 'remote');
      }
    }
  });

  const channel = sb.channel('session-memo-' + sessionId)
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 't_session_memo',
      filter: `session_id=eq.${sessionId}`
    }, payload => {
      const remote = payload.new?.content ?? '';
      if (remote === lastSaved || (isSaving && remote === textarea.value)) return;
      if (isTyping || document.activeElement === textarea) {
        pendingRemote = remote;
        setStatus('他の参加者が更新しました（入力終了後に反映）', 'remote');
        return;
      }
      textarea.value = remote;
      lastSaved = remote;
      setStatus('他の参加者の更新を反映しました', 'remote');
    })
    .subscribe(state => {
      if (state === 'CHANNEL_ERROR') setStatus('リアルタイム接続に失敗しました', 'error');
    });

  await load();
  return { destroy: async () => { destroyed = true; clearTimeout(saveTimer); await sb.removeChannel(channel); } };
};
