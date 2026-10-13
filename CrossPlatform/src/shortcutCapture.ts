// One capture session owns suspension and restoration of global shortcuts.
// React cleanup, blur and key release may all finish it in the same tick.
export class ShortcutCapture {
  private started:Promise<void>|undefined;
  private completion:Promise<void>|undefined;
  constructor(private setActive:(active:boolean)=>Promise<void>,private save:(value:string)=>Promise<void>){}
  start():Promise<void>{return this.started??=this.setActive(true);}
  finish(value?:string):Promise<void>{
    return this.completion??=this.complete(value);
  }
  private async complete(value?:string){
    if(!this.started)return;
    await this.started;
    // Register and persist the replacement before resuming dictation. A failed
    // registration leaves the previous preference intact and still restores it.
    try{if(value)await this.save(value);}
    finally{await this.setActive(false);}
  }
}
