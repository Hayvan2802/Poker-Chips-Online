import {readFile} from 'node:fs/promises'
import {test,expect,type Page} from '@playwright/test'

const key='poker-chips-local-table-v1'
const recoveryTitle='Spielstand kann nicht geladen werden'

async function expectPreserved(page:Page,raw:string) {
  await expect(page.getByRole('heading',{name:recoveryTitle})).toBeVisible()
  await expect(page.getByRole('button',{name:'Lokalen Tisch starten'})).toHaveCount(0)
  await expect(page.locator('.local-controls')).toHaveCount(0)
  expect(await page.evaluate(key=>localStorage.getItem(key),key)).toBe(raw)
  await expect(page.locator('#boot-error')).toHaveCount(0)
}

async function confirmDeletion(page:Page,accept:boolean) {
  const handled=page.waitForEvent('dialog').then(async dialog=>{
    expect(dialog.type()).toBe('confirm')
    expect(dialog.message()).toContain('wirklich löschen')
    if(accept)await dialog.accept()
    else await dialog.dismiss()
  })
  // Event listeners do not await asynchronous handlers. Finish the native dialog
  // operation before checking storage or starting the next document reload.
  await Promise.all([handled,page.getByRole('button',{name:'Beschädigten Spielstand löschen'}).click()])
}

for(const corruption of ['truncated JSON','empty string','null player','invalid previous big blind seat'] as const) {
  test(`${corruption} survives visits, reload, export and cancelled deletion until explicitly confirmed`,async({page})=>{
    const errors:string[]=[]
    page.on('pageerror',error=>errors.push(error.message))
    await page.goto('./')
    await page.getByRole('button',{name:'Alles klar'}).click()
    await page.getByRole('link',{name:/Ohne Internet auf einem Gerät spielen/}).click()
    await page.getByRole('button',{name:'Lokalen Tisch starten'}).click()
    await expect(page.getByRole('button',{name:'Hand starten & Blinds buchen'})).toBeVisible()
    const raw=await page.evaluate(({key,corruption})=>{
      const room=JSON.parse(localStorage.getItem(key)!)
      if(corruption==='null player')room.game.players['local-0']=null
      if(corruption==='invalid previous big blind seat')room.game.previousBigBlindSeat='bad'
      const raw=corruption==='empty string'?'':corruption==='truncated JSON'?' \r\n{"name":"Älex ♠",\r\n':' \r\n'+JSON.stringify(room,null,'\t')+'\r\n '
      localStorage.setItem(key,raw)
      localStorage.setItem('name','Älex ♠')
      localStorage.setItem('local-recovery-unrelated','keep me')
      return raw
    },{key,corruption})
    // A menu visit must not repair, normalize or discard the damaged save.
    await page.goto('./')
    expect(await page.evaluate(key=>localStorage.getItem(key),key)).toBe(raw)
    await page.getByRole('link',{name:/Ohne Internet auf einem Gerät spielen/}).click()
    await expectPreserved(page,raw)
    await page.reload()
    await expectPreserved(page,raw)

    const downloadPromise=page.waitForEvent('download')
    await page.getByRole('button',{name:'Spielstand herunterladen'}).click()
    const download=await downloadPromise
    expect(download.suggestedFilename()).toBe('poker-chips-spielstand.json')
    expect(await download.failure()).toBeNull()
    expect(await readFile((await download.path())!)).toEqual(Buffer.from(raw,'utf8'))
    await expectPreserved(page,raw)

    await confirmDeletion(page,false)
    await expectPreserved(page,raw)
    await page.reload()
    await expectPreserved(page,raw)

    await confirmDeletion(page,true)
    await expect(page.getByRole('heading',{name:'Runde vorbereiten'})).toBeVisible()
    expect(await page.evaluate(key=>localStorage.getItem(key),key)).toBeNull()
    expect(await page.evaluate(()=>[localStorage.getItem('name'),localStorage.getItem('local-recovery-unrelated')])).toEqual(['Älex ♠','keep me'])
    await page.reload()
    await expect(page.getByRole('heading',{name:'Runde vorbereiten'})).toBeVisible()
    expect(await page.evaluate(key=>localStorage.getItem(key),key)).toBeNull()
    await page.getByRole('button',{name:'Lokalen Tisch starten'}).click()
    await expect(page.getByRole('button',{name:'Hand starten & Blinds buchen'})).toBeVisible()
    expect(errors).toEqual([])
  })
}

test('failed deletion keeps the original save and recovery controls available',async({page})=>{
  const raw=' \r\n{broken ♠'
  await page.goto('./')
  await page.getByRole('button',{name:'Alles klar'}).click()
  await page.evaluate(({key,raw})=>{
    localStorage.setItem(key,raw)
    const remove=Storage.prototype.removeItem
    Storage.prototype.removeItem=function(name:string){
      if(name===key)throw Error('storage denied')
      return remove.call(this,name)
    }
  },{key,raw})
  await page.getByRole('link',{name:/Ohne Internet auf einem Gerät spielen/}).click()
  await expectPreserved(page,raw)
  await confirmDeletion(page,true)
  await expect(page.getByText('Der Spielstand konnte nicht gelöscht werden. Bitte versuche es erneut.')).toBeVisible()
  await expectPreserved(page,raw)
  await expect(page.getByRole('button',{name:'Spielstand herunterladen'})).toBeVisible()
})
