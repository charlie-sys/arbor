
const state = await window.api.library.getState()
return state.chats.map(c=>({id:c.id,title:c.title,count:c.messages.length,last:c.messages[c.messages.length-1]?.content?.slice(0,40)}))
