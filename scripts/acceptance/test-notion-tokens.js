
const card=document.querySelector('.doc-card'); const sidebar=document.querySelector('.sidebar'); const brand=document.querySelector('.brand-mark'); const btn=document.querySelector('.btn'); const body=getComputedStyle(document.body);
return {
  bodyBg: body.backgroundColor,
  bodyColor: body.color,
  sidebarBg: sidebar?getComputedStyle(sidebar).backgroundColor:null,
  brandBg: brand?getComputedStyle(brand).backgroundImage:null,
  cardRadius: card?getComputedStyle(card).borderRadius:null,
  cardShadow: card?getComputedStyle(card).boxShadow:null,
  cardTransform: card?getComputedStyle(card).transform:null,
  btnRadius: btn?getComputedStyle(btn).borderRadius:null
}
